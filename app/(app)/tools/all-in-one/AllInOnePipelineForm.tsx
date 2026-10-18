"use client";
/* eslint-disable react-hooks/set-state-in-effect -- reading saved presets from localStorage after mount, so SSR and the first client render match before swapping in the saved value (same pattern as MediaUploadForm.tsx) */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
  Checkbox,
  TextField,
  Icon,
  Divider,
  DropZone,
  RangeSlider,
} from "@shopify/polaris";
import { Select } from "@/components/ui/Select";
import { MagicIcon, StoreIcon, PaintBrushFlatIcon, ImageIcon, DeleteIcon } from "@shopify/polaris-icons";
import type { ScraperPlatform, ScrapeScope } from "@/lib/storeScraper/types";
import { isImageFilename } from "@/lib/skuMediaZip";
import type { LogoPosition, CanvasShape, TextOverlay } from "@/lib/backgroundComposite";
import { BackgroundModeEditor } from "@/app/(app)/tools/bg-customiser/BackgroundModeEditor";
import { createDefaultBackgroundEditorState, type BackgroundEditorState } from "@/app/(app)/tools/bg-customiser/backgroundEditorState";
import { ZoomControl, ZOOM_DEFAULT } from "@/app/(app)/tools/bg-customiser/ZoomControl";
import { LOGO_POSITIONS } from "@/app/(app)/tools/bg-customiser/logoPositions";
import { ColorSwatchPicker } from "@/app/(app)/tools/bg-customiser/ColorSwatchPicker";
import {
  MediaConversionSettings,
  DEFAULT_CONVERSION_STATE,
  type ConversionUiState,
} from "@/components/products/MediaConversionSettings";
import { pipelineRunStore, type PipelineRunConfig } from "./pipelineRunStore";
import {
  loadPresets,
  savePreset,
  deletePreset,
  toPersistablePipelineConfig,
  fromPersistablePipelineConfig,
} from "./pipelinePresets";

const PLATFORM_OPTIONS: { label: string; value: ScraperPlatform }[] = [
  { label: "Shopify", value: "shopify" },
  { label: "WordPress / WooCommerce", value: "wordpress" },
  { label: "Magento", value: "magento" },
];

const SCOPE_OPTIONS: { label: string; value: ScrapeScope }[] = [
  { label: "Entire store", value: "store" },
  { label: "One collection / category", value: "collection" },
];

/**
 * One prompt in, one zip out: runs the store scraper, then (optionally)
 * the background customiser's own compositing, then (optionally) the
 * media format converter — all against the SAME in-memory zip, so nothing
 * is re-uploaded or re-downloaded between stages. All three tools already
 * expose their actual processing as plain functions independent of their
 * own React forms (`runCompositeWorkerPool`, `runConvertWorkerPool`,
 * `uploadImageToServer`) — this page is really just a sequencer calling
 * the exact same code paths those tools use internally, with no manual
 * drag-and-drop step in between.
 *
 * The run itself lives in `pipelineRunStore.ts`, not here — this component
 * only builds the config and calls `.start()`. That split is what lets the
 * run keep going (and stay visible via the floating widget in `AppFrame`)
 * after navigating away from this very page.
 */
type DesktopPermission = NotificationPermission | "unsupported";

// Notification permission lives in the browser, not in React. Reading it with useSyncExternalStore keeps the server
// render and the first client render identical ("unsupported", i.e. disabled) and then swaps in the real value —
// reading Notification.permission straight into useState made the checkbox differ between server and client (hydration error).
const permissionListeners = new Set<() => void>();
const subscribeToPermission = (listener: () => void): (() => void) => {
  permissionListeners.add(listener);
  return () => {
    permissionListeners.delete(listener);
  };
};
const readDesktopPermission = (): DesktopPermission => (typeof Notification === "undefined" ? "unsupported" : Notification.permission);
const readServerPermission = (): DesktopPermission => "unsupported";

export function AllInOnePipelineForm() {
  const runState = useSyncExternalStore(pipelineRunStore.subscribe, pipelineRunStore.getSnapshot, pipelineRunStore.getSnapshot);
  const running = pipelineRunStore.isRunning();

  // ---- Step 1: scrape ----
  const [platform, setPlatform] = useState<ScraperPlatform>("shopify");
  const [scope, setScope] = useState<ScrapeScope>("store");
  const [storeUrl, setStoreUrl] = useState("");
  const [requestedFieldsText, setRequestedFieldsText] = useState("");
  const [containerClassesText, setContainerClassesText] = useState("");
  const [useCache, setUseCache] = useState(true);
  const [allowInsecureTls, setAllowInsecureTls] = useState(false);
  const [quickMediaMode, setQuickMediaMode] = useState(false);

  // ---- Step 2: background (optional) ----
  // Column A and Column B, each with their own full background picker,
  // exactly like the background customiser itself — completely independent
  // configs, and if the same position ends up listed in both, Column A wins
  // (same as checking a shot number in Column A clearing it from Column B
  // there). Same picker component too, all four modes selectable — unlike a
  // live sample in that tool, there's no image here yet to check
  // transparency against, so `sampleTransparent={null}` below just means
  // "unknown, don't restrict anything" rather than forcing one specific mode.
  const [enableBackground, setEnableBackground] = useState(true);
  const [bgStateA, setBgStateA] = useState<BackgroundEditorState>(createDefaultBackgroundEditorState);
  const [bgPositionsTextA, setBgPositionsTextA] = useState("1");
  const [bgStateB, setBgStateB] = useState<BackgroundEditorState>(createDefaultBackgroundEditorState);
  const [bgPositionsTextB, setBgPositionsTextB] = useState("");

  // ---- Zoom & logo (optional) — applies to every image, same as BgCustomiserForm.tsx's own "Zoom & logo" card ----
  const [zoomPercent, setZoomPercent] = useState(ZOOM_DEFAULT);
  const [canvasShape, setCanvasShape] = useState<CanvasShape>("original");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [logoPosition, setLogoPosition] = useState<LogoPosition>("bottom-right");
  const [logoCustomX, setLogoCustomX] = useState(50);
  const [logoCustomY, setLogoCustomY] = useState(50);
  const [logoSizePercent, setLogoSizePercent] = useState(20);
  const [logoMarginPercent, setLogoMarginPercent] = useState(4);

  // ---- Text overlay (optional) — same global scope as zoom/logo ----
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

  // ---- Step 3: format conversion (optional) ----
  const [enableConversion, setEnableConversion] = useState(true);
  const [conversionUi, setConversionUi] = useState<ConversionUiState>(DEFAULT_CONVERSION_STATE);

  // ---- Finish notifications (optional) ----
  const [notifyWebhookUrl, setNotifyWebhookUrl] = useState("");
  const [notifyDesktop, setNotifyDesktop] = useState(false);
  const desktopPermission = useSyncExternalStore(subscribeToPermission, readDesktopPermission, readServerPermission);

  // ---- Presets: everything above except the store URL and the two File fields (a background image, a logo) ----
  const [presets, setPresets] = useState<Record<string, ReturnType<typeof toPersistablePipelineConfig>>>({});
  const [selectedPresetName, setSelectedPresetName] = useState("");
  const [newPresetName, setNewPresetName] = useState("");

  useEffect(() => {
    setPresets(loadPresets());
  }, []);

  const patchBgStateA = (patch: Partial<BackgroundEditorState>) => setBgStateA((prev) => ({ ...prev, ...patch }));
  const patchBgStateB = (patch: Partial<BackgroundEditorState>) => setBgStateB((prev) => ({ ...prev, ...patch }));

  const currentPresetSnapshot = () =>
    toPersistablePipelineConfig({
      platform,
      scope,
      requestedFields: requestedFieldsText,
      containerClasses: containerClassesText,
      useCache,
      allowInsecureTls,
      quickMediaMode,
      enableBackground,
      bgStateA,
      bgPositionsTextA,
      bgStateB,
      bgPositionsTextB,
      zoomPercent,
      canvasShape,
      logoPosition,
      logoCustomX,
      logoCustomY,
      logoSizePercent,
      logoMarginPercent,
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
      enableConversion,
      conversionUi,
      notifyWebhookUrl,
      notifyDesktop,
    });

  const handleSavePreset = () => {
    const name = newPresetName.trim();
    if (!name) return;
    savePreset(name, currentPresetSnapshot());
    setPresets(loadPresets());
    setSelectedPresetName(name);
    setNewPresetName("");
  };

  const handleLoadPreset = (name: string) => {
    setSelectedPresetName(name);
    const preset = presets[name];
    if (!preset) return;
    const { bgStateA: loadedA, bgStateB: loadedB } = fromPersistablePipelineConfig(preset);
    setPlatform(preset.platform);
    setScope(preset.scope);
    setRequestedFieldsText(preset.requestedFields);
    setContainerClassesText(preset.containerClasses);
    setUseCache(preset.useCache);
    setAllowInsecureTls(preset.allowInsecureTls);
    setQuickMediaMode(preset.quickMediaMode);
    setEnableBackground(preset.enableBackground);
    setBgStateA(loadedA);
    setBgPositionsTextA(preset.bgPositionsTextA);
    setBgStateB(loadedB);
    setBgPositionsTextB(preset.bgPositionsTextB);
    setZoomPercent(preset.zoomPercent);
    setCanvasShape(preset.canvasShape);
    setLogoPosition(preset.logoPosition);
    setLogoCustomX(preset.logoCustomX);
    setLogoCustomY(preset.logoCustomY);
    setLogoSizePercent(preset.logoSizePercent);
    setLogoMarginPercent(preset.logoMarginPercent);
    setTextOverlayEnabled(preset.textOverlayEnabled);
    setTextOverlayText(preset.textOverlayText);
    setTextOverlayPosition(preset.textOverlayPosition);
    setTextOverlayCustomX(preset.textOverlayCustomX);
    setTextOverlayCustomY(preset.textOverlayCustomY);
    setTextOverlaySizePercent(preset.textOverlaySizePercent);
    setTextOverlayMarginPercent(preset.textOverlayMarginPercent);
    setTextOverlayColor(preset.textOverlayColor);
    setTextOverlayHasBackground(preset.textOverlayHasBackground);
    setTextOverlayBackgroundColor(preset.textOverlayBackgroundColor);
    setEnableConversion(preset.enableConversion);
    setConversionUi(preset.conversionUi);
    setNotifyWebhookUrl(preset.notifyWebhookUrl);
    setNotifyDesktop(preset.notifyDesktop);
  };

  const handleDeletePreset = (name: string) => {
    deletePreset(name);
    setPresets(loadPresets());
    if (selectedPresetName === name) setSelectedPresetName("");
  };

  const handleRequestDesktopPermission = async () => {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    for (const listener of permissionListeners) listener();
    if (result === "granted") setNotifyDesktop(true);
  };

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

  const handleRun = () => {
    if (!storeUrl.trim()) return;
    const config: PipelineRunConfig = {
      platform,
      scope,
      storeUrl,
      requestedFields: requestedFieldsText,
      containerClasses: containerClassesText,
      useCache,
      allowInsecureTls,
      quickMediaMode,
      enableBackground,
      bgStateA,
      bgPositionsTextA,
      bgStateB,
      bgPositionsTextB,
      zoomPercent,
      canvasShape,
      logoFile,
      logoPosition,
      logoCustomX,
      logoCustomY,
      logoSizePercent,
      logoMarginPercent,
      textOverlay,
      enableConversion,
      conversionUi,
      notifyWebhookUrl,
      notifyDesktop,
    };
    void pipelineRunStore.start(config);
  };

  return (
    <Page
      fullWidth
      title="All-in-one pipeline"
      subtitle="Scrape a store, change backgrounds, and convert image format — one run, one final zip. Chains the Store scraper, Background customiser, and Media format converter tools together so you don't have to hand a zip from one to the next yourself."
      titleMetadata={<Badge tone="magic">Personal tool</Badge>}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="150" blockAlign="center">
                <Icon source={MagicIcon} tone="subdued" />
                <BlockStack gap="0">
                  <Text as="h2" variant="headingSm">Presets</Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    Saves everything below except the store URL itself (and any background/logo image files) — load
                    one, then just type in today&apos;s target URL.
                  </Text>
                </BlockStack>
              </InlineStack>
              <InlineGridRow>
                <Select
                  label="Saved presets"
                  labelHidden
                  options={[{ label: "— None loaded —", value: "" }, ...Object.keys(presets).map((name) => ({ label: name, value: name }))]}
                  value={selectedPresetName}
                  onChange={handleLoadPreset}
                  disabled={running || Object.keys(presets).length === 0}
                />
                <InlineStack gap="200">
                  {selectedPresetName && (
                    <Button tone="critical" onClick={() => handleDeletePreset(selectedPresetName)} disabled={running}>
                      Delete
                    </Button>
                  )}
                </InlineStack>
              </InlineGridRow>
              <InlineGridRow>
                <TextField
                  label="Save current settings as"
                  labelHidden
                  autoComplete="off"
                  value={newPresetName}
                  onChange={setNewPresetName}
                  placeholder="e.g. Shopify — cream background"
                  disabled={running}
                />
                <Button onClick={handleSavePreset} disabled={running || !newPresetName.trim()}>
                  Save preset
                </Button>
              </InlineGridRow>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="150" blockAlign="center">
                <Box background="bg-fill-info" padding="150" borderRadius="150">
                  <span style={{ color: "#fff", display: "flex" }}>
                    <Icon source={StoreIcon} tone="inherit" />
                  </span>
                </Box>
                <Text as="h2" variant="headingSm">1. What to scrape</Text>
              </InlineStack>

              <InlineGridRow>
                <Select label="Platform" options={PLATFORM_OPTIONS} value={platform} onChange={(v) => setPlatform(v as ScraperPlatform)} disabled={running} />
                <Select label="Scope" options={SCOPE_OPTIONS} value={scope} onChange={(v) => setScope(v as ScrapeScope)} disabled={running} />
              </InlineGridRow>

              <TextField
                label={scope === "collection" ? "Collection / category URL" : "Store URL (home page or domain)"}
                value={storeUrl}
                onChange={setStoreUrl}
                autoComplete="off"
                disabled={running}
                placeholder="https://example.com"
              />

              <InlineGridRow>
                <TextField
                  label="Data fields to capture"
                  helpText="One per line — leave blank to capture everything found."
                  multiline={4}
                  autoComplete="off"
                  value={requestedFieldsText}
                  onChange={setRequestedFieldsText}
                  disabled={running}
                  placeholder={"Dimension\nPackage Contents\nMaterial\nWeight"}
                />
                <TextField
                  label="Custom field container classes (optional)"
                  helpText="Class name(s) of the block to read every <li> from, e.g. when fields are missing."
                  autoComplete="off"
                  value={containerClassesText}
                  onChange={setContainerClassesText}
                  disabled={running}
                  placeholder="internal-features-list"
                />
              </InlineGridRow>

              <InlineStack gap="400" wrap>
                <Checkbox label="Use cached results if this exact store was scraped before" checked={useCache} onChange={setUseCache} disabled={running} />
                <Checkbox label="Allow insecure TLS (self-signed certs)" checked={allowInsecureTls} onChange={setAllowInsecureTls} disabled={running} />
                <Checkbox label="Quick media mode (skip slower per-image checks)" checked={quickMediaMode} onChange={setQuickMediaMode} disabled={running} />
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="150" blockAlign="center">
                  <Box background="bg-fill-magic" padding="150" borderRadius="150">
                    <span style={{ color: "#fff", display: "flex" }}>
                      <Icon source={PaintBrushFlatIcon} tone="inherit" />
                    </span>
                  </Box>
                  <Text as="h2" variant="headingSm">2. Change background color (optional)</Text>
                </InlineStack>
                <Checkbox label="Enable" checked={enableBackground} onChange={setEnableBackground} disabled={running} />
              </InlineStack>

              {enableBackground && (
                <InlineGrid columns={{ xs: 1, lg: 2 }} gap="500">
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingXs">Column A</Text>
                    <TextField
                      label="Image position(s) to apply to"
                      helpText="1-based, matches the background customiser's own numbering (1st photo, 2nd photo, ...) — comma-separated, or leave blank for every image. If a position is listed in both columns, Column A wins."
                      value={bgPositionsTextA}
                      onChange={setBgPositionsTextA}
                      autoComplete="off"
                      disabled={running}
                      placeholder="e.g. 1 or 1,3"
                    />
                    <Divider />
                    <BackgroundModeEditor
                      state={bgStateA}
                      onChange={patchBgStateA}
                      sampleTransparent={null}
                      hasSample={false}
                      onImageDrop={handleBgImageDropA}
                    />
                  </BlockStack>

                  <BlockStack gap="300">
                    <Text as="h3" variant="headingXs">Column B</Text>
                    <TextField
                      label="Image position(s) to apply to"
                      helpText="Same numbering as Column A — comma-separated, or leave blank for every image not already claimed by Column A."
                      value={bgPositionsTextB}
                      onChange={setBgPositionsTextB}
                      autoComplete="off"
                      disabled={running}
                      placeholder="e.g. 2 or 2,4"
                    />
                    <Divider />
                    <BackgroundModeEditor
                      state={bgStateB}
                      onChange={patchBgStateB}
                      sampleTransparent={null}
                      hasSample={false}
                      onImageDrop={handleBgImageDropB}
                    />
                  </BlockStack>
                </InlineGrid>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="150" blockAlign="center">
                <Box background="bg-fill-info" padding="150" borderRadius="150">
                  <span style={{ color: "#fff", display: "flex" }}>
                    <Icon source={ImageIcon} tone="inherit" />
                  </span>
                </Box>
                <BlockStack gap="050">
                  <Text as="h2" variant="headingSm">3. Zoom, shape &amp; logo (optional)</Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    Applied to every image in the zip, regardless of the background step above — same as the
                    background customiser&apos;s own &quot;Zoom, shape &amp; logo&quot; card.
                  </Text>
                </BlockStack>
              </InlineStack>

              <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
                <BlockStack gap="300">
                  <BlockStack gap="150">
                    <Text as="span" variant="bodySm" fontWeight="medium">Zoom</Text>
                    <ZoomControl value={zoomPercent} onChange={setZoomPercent} />
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
                        A non-square photo gets padded to a square canvas — nothing is cropped.
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
                    <DropZone accept="image/*" type="file" allowMultiple={false} onDrop={(_files, accepted) => accepted.length > 0 && handleLogoDrop(accepted)}>
                      <DropZone.FileUpload actionTitle="Add logo" actionHint="or drop an image" />
                    </DropZone>
                  ) : (
                    <div
                      style={{
                        flex: 1,
                        minHeight: 160,
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
                    <Text as="h2" variant="headingSm">4. Text overlay (optional)</Text>
                    <Text as="p" tone="subdued" variant="bodySm">
                      A second stamp layered on top of the logo — same scope as Zoom, shape &amp; logo.
                    </Text>
                  </BlockStack>
                </InlineStack>
                <Checkbox label="Enable" checked={textOverlayEnabled} onChange={setTextOverlayEnabled} disabled={running} />
              </InlineStack>

              {textOverlayEnabled && (
                <BlockStack gap="300">
                  <TextField
                    label="Text"
                    autoComplete="off"
                    value={textOverlayText}
                    onChange={setTextOverlayText}
                    placeholder="New"
                    disabled={running}
                  />
                  <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
                    <BlockStack gap="150">
                      <Text as="span" variant="bodySm" fontWeight="medium">Position</Text>
                      <InlineStack gap="150" wrap>
                        {LOGO_POSITIONS.map((p) => (
                          <Button key={p.value} pressed={textOverlayPosition === p.value} onClick={() => setTextOverlayPosition(p.value)} disabled={running}>
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
                      <InlineStack gap="150" blockAlign="center">
                        <ColorSwatchPicker label="Text color" value={textOverlayColor} onChange={setTextOverlayColor} />
                        <Text as="span" tone="subdued" variant="bodySm">Text</Text>
                      </InlineStack>
                      <Checkbox
                        label="Backing box behind the text"
                        checked={textOverlayHasBackground}
                        onChange={setTextOverlayHasBackground}
                        disabled={running}
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
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="150" blockAlign="center">
                  <Box background="bg-fill-success" padding="150" borderRadius="150">
                    <span style={{ color: "#fff", display: "flex" }}>
                      <Icon source={ImageIcon} tone="inherit" />
                    </span>
                  </Box>
                  <Text as="h2" variant="headingSm">5. Convert image format (optional)</Text>
                </InlineStack>
                <Checkbox label="Enable" checked={enableConversion} onChange={setEnableConversion} disabled={running} />
              </InlineStack>

              {enableConversion && (
                <MediaConversionSettings
                  value={conversionUi}
                  onChange={setConversionUi}
                  onPreview={() => {}}
                  previewing={false}
                  previewSummary={null}
                  showReplaceMode={false}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="150" blockAlign="center">
                <Box background="bg-fill-info" padding="150" borderRadius="150">
                  <span style={{ color: "#fff", display: "flex" }}>
                    <Icon source={ImageIcon} tone="inherit" />
                  </span>
                </Box>
                <BlockStack gap="0">
                  <Text as="h2" variant="headingSm">6. Notify me when done (optional)</Text>
                  <Text as="p" tone="subdued" variant="bodySm">A run can take a while unattended — get a ping the moment it finishes, fails, or is cancelled.</Text>
                </BlockStack>
              </InlineStack>

              <InlineGridRow>
                <BlockStack gap="150">
                  <Checkbox
                    label="Desktop notification"
                    checked={notifyDesktop && desktopPermission === "granted"}
                    onChange={(checked) => (checked ? void handleRequestDesktopPermission() : setNotifyDesktop(false))}
                    disabled={desktopPermission === "unsupported"}
                  />
                  {desktopPermission === "denied" && (
                    <Text as="span" tone="critical" variant="bodySm">Notifications are blocked for this site in your browser settings.</Text>
                  )}
                  {desktopPermission === "unsupported" && (
                    <Text as="span" tone="subdued" variant="bodySm">Not supported in this browser.</Text>
                  )}
                </BlockStack>
                <TextField
                  label="Slack or Discord webhook URL (optional)"
                  autoComplete="off"
                  value={notifyWebhookUrl}
                  onChange={setNotifyWebhookUrl}
                  placeholder="https://hooks.slack.com/services/... or https://discord.com/api/webhooks/..."
                />
              </InlineGridRow>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="150" blockAlign="center">
                  <Box background="bg-fill-brand" padding="150" borderRadius="150">
                    <span style={{ color: "#fff", display: "flex" }}>
                      <Icon source={MagicIcon} tone="inherit" />
                    </span>
                  </Box>
                  <Text as="h2" variant="headingSm">7. Run</Text>
                </InlineStack>
                {!running && (
                  <Button variant="primary" icon={MagicIcon} onClick={handleRun} disabled={!storeUrl.trim()}>
                    Run pipeline
                  </Button>
                )}
              </InlineStack>

              {runState.stage === "idle" ? (
                <Text as="p" tone="subdued" variant="bodySm">
                  Progress shows in a popup once you run this — close it any time and a floating status stays in the
                  bottom-right corner, on any page, until it&apos;s done.
                </Text>
              ) : (
                <InlineStack gap="150" blockAlign="center">
                  <Text as="span" tone="subdued" variant="bodySm">
                    {running ? "Running — see the floating status in the bottom-right corner, or:" : "Finished — see:"}
                  </Text>
                  <Button variant="plain" onClick={() => pipelineRunStore.setPopupOpen(true)}>
                    Open progress
                  </Button>
                </InlineStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

/** A simple two-column responsive row — this page has just enough of these to not warrant importing Polaris's own `InlineGrid` differently than the rest of the app already does, but named locally so the two `Select`s above read cleanly. */
function InlineGridRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
      {children}
    </div>
  );
}
