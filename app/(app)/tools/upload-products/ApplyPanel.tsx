"use client";

import { useEffect, useRef, useState } from "react";
import { Box, BlockStack, InlineStack, Text, Button, ButtonGroup, Banner, Badge, Modal, DataTable, Checkbox } from "@shopify/polaris";
import { ImportIcon } from "@shopify/polaris-icons";
import { buildCsv, downloadCsv } from "@/lib/csvExport";
import { idFromGid } from "@/lib/format";
import type { NewGroup, UpdateGroup } from "@/lib/skuMatch";
import type { MetafieldDefinitionSummary } from "@/lib/shopify/metafields";
import {
  APPLY_FIELDS,
  guessMetafieldColumn,
  isVariantField,
  metafieldWritesFromRow,
  suggestFieldMapping,
  valuesFromRow,
  type ApplyFieldKey,
  type ApplyFieldGroup,
  type ApplyItem,
  type ApplyResult,
  type FieldMapping,
  type MetafieldMapping,
  type ProductStatusValue,
  type SkuTarget,
} from "@/lib/skuApply";
import type { FieldCheck } from "@/lib/shopify/verifyProduct";
import type { StockLocation } from "@/lib/shopify/stock";
import { getLocationsAction, getSkuMetafieldOptionsAction, verifyApplyAction } from "./actions";
import { WorkersField } from "@/components/WorkersField";
import { DEFAULT_WORKERS, MAX_WORKERS, runApplyWorkers } from "./applyWorkers";
import type { RichTextFormat } from "@/lib/richText";
import { MappingRow, MappingSection } from "./MappingRow";
import { applySavedFieldMapping, loadUploadSettings, resetUploadSettings, saveUploadSettings } from "@/lib/uploadSettings";
import { SharedSkusPanel, sharedProducts } from "./SharedSkusPanel";
import { RunStatusList, RunSummary, type RowStatus, type RunRow } from "./RunStatusList";
import { useUpToDateScan } from "./useUpToDateScan";

const NO_KEYS: ReadonlySet<string> = new Set();
import { MetafieldMappingSection, type MetafieldColumnMap } from "./MetafieldMappingSection";
import { SearchableSelect, type PickerOption } from "./SearchableSelect";

const GROUP_TITLES: Record<ApplyFieldGroup, { title: string; description: string }> = {
  product: { title: "Product fields", description: "Apply to the whole product." },
  variant: { title: "Variant fields", description: "Apply to the variant that was matched by SKU." },
};

type PublishMode = "all" | "none" | "column" | "keep";

const PUBLISH_MODES: { value: PublishMode; label: string }[] = [
  { value: "all", label: "Published — TRUE for all" },
  { value: "none", label: "Unpublished — FALSE for all" },
  { value: "column", label: "From a CSV column" },
  { value: "keep", label: "Don't change" },
];

const PUBLISH_HINT: Record<PublishMode, string> = {
  all: "Every product in this run, updated or new, is published to all your sales channels (the default).",
  none: "Every product in this run is removed from all sales channels.",
  column: "Reads TRUE / FALSE from the column for each row. A blank cell counts as TRUE.",
  keep: "Sales-channel availability is left as it is. New products are not published anywhere.",
};

type StatusMode = "none" | "column" | ProductStatusValue;

const STATUS_MODES: { value: StatusMode; label: string }[] = [
  { value: "none", label: "Don't change" },
  { value: "column", label: "From a CSV column" },
  { value: "ACTIVE", label: "Set all to Active" },
  { value: "DRAFT", label: "Set all to Draft" },
  { value: "ARCHIVED", label: "Set all to Archived" },
];

const STATUS_HINT: Record<StatusMode, string> = {
  none: "Existing products keep their status; new products are created as drafts.",
  column: "Read each row's status from the CSV — values must be active, draft or archived.",
  ACTIVE: "Every product in this run, updated or new, is set to Active (visible on the storefront).",
  DRAFT: "Every product in this run, updated or new, is set to Draft.",
  ARCHIVED: "Every product in this run, updated or new, is set to Archived.",
};

interface RowOutcome {
  sku: string;
  action: "update" | "create";
  result: ApplyResult;
}

export function ApplyPanel({
  headers,
  updateGroups,
  createGroups,
  sharedCount,
  untickedCount,
  sharedGroups,
  target,
  storeName,
  onResetSettings,
}: {
  headers: string[];
  /** Update rows that are checked in the table and not blocked (shared SKUs never reach here). */
  updateGroups: UpdateGroup[];
  createGroups: NewGroup[];
  /** Update SKUs left out because several store products share them. */
  sharedCount: number;
  /** SKUs the user unchecked (shared SKUs are counted separately, not here). */
  untickedCount: number;
  /** SKUs that several store products carry — listed, and updated only when the user opts in. */
  sharedGroups: UpdateGroup[];
  /** Where a new product's SKU is written; null when the chosen store field can't hold it. */
  target: SkuTarget | null;
  storeName: string;
  /** Called after the saved settings were cleared, so the page can rebuild this panel from the defaults. */
  onResetSettings: () => void;
}) {
  // What was saved last time (read once when the panel appears); every change below is saved again automatically.
  const [saved] = useState(loadUploadSettings);
  const [mapping, setMapping] = useState<FieldMapping>(() => applySavedFieldMapping(suggestFieldMapping(headers), headers, saved.fieldHeaders));
  // Which fields were picked from a matching header on load — shown as a hint so an automatic choice is never a surprise.
  const [autoFields] = useState<ReadonlySet<ApplyFieldKey>>(() => {
    const guess = suggestFieldMapping(headers);
    const restored = applySavedFieldMapping(guess, headers, saved.fieldHeaders);
    return new Set((Object.keys(guess) as ApplyFieldKey[]).filter((key) => restored[key] === guess[key]));
  });
  const [publishMode, setPublishMode] = useState<PublishMode>(() =>
    saved.publishMode && PUBLISH_MODES.some((m) => m.value === saved.publishMode)
      ? (saved.publishMode as PublishMode)
      : suggestFieldMapping(headers).published !== undefined
        ? "column"
        : "all",
  );
  const [statusMode, setStatusMode] = useState<StatusMode>(() =>
    saved.statusMode && STATUS_MODES.some((m) => m.value === saved.statusMode)
      ? (saved.statusMode as StatusMode)
      : suggestFieldMapping(headers).status !== undefined
        ? "column"
        : "none",
  );
  const [definitions, setDefinitions] = useState<MetafieldDefinitionSummary[] | null>(null);
  const [definitionsError, setDefinitionsError] = useState<string | null>(null);
  const [metafieldMapping, setMetafieldMapping] = useState<MetafieldColumnMap>({});
  const [metafieldFixed, setMetafieldFixed] = useState<Record<string, string>>({});
  const [metafieldFormat, setMetafieldFormat] = useState<Record<string, RichTextFormat>>({});
  const [autoMetafieldIds, setAutoMetafieldIds] = useState<ReadonlySet<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [outcomes, setOutcomes] = useState<RowOutcome[]>([]);
  const [cancelled, setCancelled] = useState(false);
  const [stopping, setStopping] = useState(false);
  // Where the inventory quantity is set — loaded from the store, and remembered like the other choices.
  const [locations, setLocations] = useState<StockLocation[] | null>(null);
  const [locationsError, setLocationsError] = useState<string | null>(null);
  const [locationId, setLocationId] = useState(saved.locationId ?? "");
  const [includeShared, setIncludeShared] = useState(saved.includeShared ?? false);
  const [skipUnchanged, setSkipUnchanged] = useState(saved.skipUnchanged ?? true);
  const [workers, setWorkers] = useState(() => (typeof saved.workers === "number" ? Math.max(1, Math.min(MAX_WORKERS, Math.floor(saved.workers))) : DEFAULT_WORKERS));
  const [verifying, setVerifying] = useState(false);
  // Live per-SKU status for the list at the bottom; runRows is the snapshot of the run in progress (or the last one), so finished SKUs stay listed.
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});
  const [runRows, setRunRows] = useState<RunRow[]>([]);
  const [currentSku, setCurrentSku] = useState<string | null>(null);
  const [verification, setVerification] = useState<{ sku: string; checks: FieldCheck[] | null; error?: string }[]>([]);
  const cancelRef = useRef(false);
  const scan = useUpToDateScan();
  // SKUs that already went through successfully this session — never sent twice, so re-running can't create duplicate products.
  const [doneSkus, setDoneSkus] = useState<Set<string>>(new Set());

  // A status column only counts while "From a CSV column" is chosen; a fixed status is applied to every row instead.
  const effectiveMapping: FieldMapping = { ...mapping };
  if (statusMode !== "column") delete effectiveMapping.status;
  if (publishMode !== "column") delete effectiveMapping.published;
  const fixedStatus: ProductStatusValue | null = statusMode === "ACTIVE" || statusMode === "DRAFT" || statusMode === "ARCHIVED" ? statusMode : null;
  const rowValues = (cells: string[]) => {
    const values = valuesFromRow(cells, effectiveMapping);
    if (fixedStatus) values.status = fixedStatus;
    if (publishMode === "all") values.published = "true";
    else if (publishMode === "none") values.published = "false";
    else if (publishMode === "column" && values.published === undefined) values.published = "true";
    return values;
  };

  // Load the store's metafield definitions once, and pre-select a CSV column for every metafield whose header names it.
  useEffect(() => {
    let cancelled = false;
    void getSkuMetafieldOptionsAction().then((response) => {
      if (cancelled) return;
      if (!response.ok) {
        setDefinitionsError(response.error ?? "Couldn't load the store's metafields.");
        setDefinitions([]);
        return;
      }
      const taken = new Set(Object.values(suggestFieldMapping(headers)));
      const guessed: MetafieldColumnMap = {};
      for (const definition of response.definitions) {
        const column = guessMetafieldColumn(headers, definition, taken);
        if (column >= 0) {
          guessed[definition.id] = column;
          taken.add(column);
        }
      }
      const autoIds = new Set(Object.keys(guessed));
      const restoredFixed: Record<string, string> = {};
      const restoredFormats: Record<string, RichTextFormat> = {};
      for (const definition of response.definitions) {
        const entry = saved.metafields?.[`${definition.namespace}.${definition.key}`];
        if (!entry) continue;
        if (entry.fixed !== undefined && definition.typeName === "rich_text_field") {
          delete guessed[definition.id];
          autoIds.delete(definition.id);
          restoredFixed[definition.id] = entry.fixed;
        } else if (entry.header === "") {
          delete guessed[definition.id];
          autoIds.delete(definition.id);
        } else {
          const index = headers.indexOf(entry.header);
          if (index >= 0) {
            if (guessed[definition.id] !== index) autoIds.delete(definition.id);
            guessed[definition.id] = index;
          }
        }
        if (entry.format === "paragraphs" || entry.format === "bullets" || entry.format === "numbered") restoredFormats[definition.id] = entry.format;
      }
      setDefinitions(response.definitions);
      setMetafieldMapping(guessed);
      setMetafieldFixed(restoredFixed);
      setMetafieldFormat(restoredFormats);
      setAutoMetafieldIds(autoIds);
    });
    return () => {
      cancelled = true;
    };
  }, [headers, saved]);

  // ---- Auto-save: every choice is written to this browser as it changes.
  useEffect(() => {
    const fieldHeaders: Record<string, string> = {};
    for (const field of APPLY_FIELDS) {
      const index = mapping[field.key];
      if (index !== undefined) fieldHeaders[field.key] = headers[index] ?? "";
      else {
        // A field set to a header this CSV doesn't have keeps its saved choice for the next CSV that does.
        const previous = saved.fieldHeaders?.[field.key];
        fieldHeaders[field.key] = previous && !headers.includes(previous) ? previous : "";
      }
    }
    saveUploadSettings({ fieldHeaders, statusMode, publishMode, workers, locationId, includeShared, skipUnchanged });
  }, [mapping, headers, statusMode, publishMode, workers, locationId, includeShared, skipUnchanged, saved]);

  useEffect(() => {
    let cancelled = false;
    void getLocationsAction().then((response) => {
      if (cancelled) return;
      if (!response.ok) setLocationsError(response.error ?? "Couldn't load the store's locations.");
      setLocations(response.locations);
      // Keep the remembered location when it still exists, otherwise start on the store's first one.
      setLocationId((previous) => (response.locations.some((l) => l.id === previous) ? previous : (response.locations[0]?.id ?? "")));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (definitions === null) return;
    const metafields: NonNullable<ReturnType<typeof loadUploadSettings>["metafields"]> = {};
    for (const definition of definitions) {
      const name = `${definition.namespace}.${definition.key}`;
      const fixed = metafieldFixed[definition.id];
      const column = metafieldMapping[definition.id];
      const format = metafieldFormat[definition.id];
      if (fixed !== undefined) metafields[name] = { header: "", fixed, ...(format ? { format } : {}) };
      else if (column !== undefined) metafields[name] = { header: headers[column] ?? "", ...(format ? { format } : {}) };
      else {
        const previous = saved.metafields?.[name];
        metafields[name] = previous && previous.fixed === undefined && previous.header && !headers.includes(previous.header) ? previous : { header: "" };
      }
    }
    saveUploadSettings({ metafields });
  }, [definitions, metafieldMapping, metafieldFixed, metafieldFormat, headers, saved]);

  const metafieldMappings: MetafieldMapping[] = (definitions ?? []).flatMap((d) => {
    const fixed = metafieldFixed[d.id];
    const column = metafieldMapping[d.id];
    if (fixed === undefined && column === undefined) return [];
    return [{ namespace: d.namespace, key: d.key, type: d.typeName, column, fixed, format: metafieldFormat[d.id] }];
  });
  const changeMetafieldFixed = (definitionId: string, html: string | null) =>
    setMetafieldFixed((prev) => {
      const next = { ...prev };
      if (html === null) delete next[definitionId];
      else next[definitionId] = html;
      return next;
    });
  const changeMetafieldFormat = (definitionId: string, format: RichTextFormat) => setMetafieldFormat((prev) => ({ ...prev, [definitionId]: format }));
  const rowMetafields = (cells: string[]) => metafieldWritesFromRow(cells, metafieldMappings);
  const changeMetafield = (definitionId: string, column: number | null) =>
    setMetafieldMapping((prev) => {
      const next = { ...prev };
      if (column === null) delete next[definitionId];
      else next[definitionId] = column;
      return next;
    });
  const changeField = (key: ApplyFieldKey, value: string) =>
    setMapping((prev) => {
      const next = { ...prev };
      if (value === "") delete next[key];
      else next[key] = Number(value);
      return next;
    });

  const mappedCount = Object.keys(effectiveMapping).length + (fixedStatus ? 1 : 0) + (publishMode === "all" || publishMode === "none" ? 1 : 0) + metafieldMappings.length;
  const titleMapped = mapping.title !== undefined;
  const canCreate = titleMapped && target !== null;

  // Results of "Check what's already up to date" only count while the mapping they were run for is unchanged.
  const scanSignature = JSON.stringify([effectiveMapping, metafieldMappings, publishMode, statusMode, locationId, includeShared]);
  const scanSkipped: ReadonlySet<string> = scan.state.signature === scanSignature ? scan.state.upToDate : NO_KEYS;

  const pendingUpdates = updateGroups.filter((g) => !doneSkus.has(g.sku));
  const pendingCreates = canCreate ? createGroups.filter((g) => !doneSkus.has(g.sku)) : [];
  // Each store product behind a shared SKU is its own update; the key keeps them apart (the SKU alone would collide).
  const sharedTargets = sharedGroups.flatMap((group) =>
    sharedProducts(group).map((match) => ({ key: `${group.sku}#${idFromGid(match.productId)}`, group, match })),
  );
  const pendingShared = includeShared ? sharedTargets.filter((t) => !doneSkus.has(t.key)) : [];
  const scanSkippedCount = [...pendingUpdates.map((g) => g.sku), ...pendingShared.map((t) => t.key), ...pendingCreates.map((g) => g.sku)].filter((key) => scanSkipped.has(key)).length;
  const readyCount = pendingUpdates.length + pendingCreates.length + pendingShared.length - scanSkippedCount;
  // The counts shown beside the button: only what still has to be written, with the up-to-date ones named separately.
  const toUpdateCount = pendingUpdates.filter((g) => !scanSkipped.has(g.sku)).length;
  const toCreateCount = pendingCreates.filter((g) => !scanSkipped.has(g.sku)).length;
  const sharedToUpdateCount = pendingShared.filter((t) => !scanSkipped.has(t.key)).length;
  const nothingToUpdate = readyCount === 0 && scanSkippedCount > 0;
  // Rows found up to date show as such in the list even before a run.
  const shownStatuses: Record<string, RowStatus> = { ...rowStatus };
  for (const key of scanSkipped) {
    if (!shownStatuses[key] || shownStatuses[key].state === "waiting") shownStatuses[key] = { state: "skipped", message: "Already up to date — will be skipped" };
  }
  const blockedNewCount = canCreate ? 0 : createGroups.length;

  const sampleRow: string[] = (updateGroups[0] ?? createGroups[0])?.rows[0]?.cells ?? [];
  const clearAllMappings = () => {
    setMapping({});
    setMetafieldMapping({});
    setMetafieldFixed({});
    setMetafieldFormat({});
    setStatusMode("none");
    setPublishMode("keep");
  };

  const columnOptions: PickerOption[] = headers.map((h, i) => ({ value: String(i), label: h }));

  // Products an earlier run created (even if a later step failed) — a re-run must finish those, never create them a second time.
  const [createdBefore, setCreatedBefore] = useState<Map<string, { productId: string; variantId: string | null }>>(new Map());
  const knownCreated = () => {
    const known = new Map(createdBefore);
    for (const o of outcomes) if (o.action === "create" && o.result.productId) known.set(o.sku, { productId: o.result.productId, variantId: o.result.variantId ?? null });
    return known;
  };

  const titleOf = (cells: string[]): string => (mapping.title !== undefined ? (cells[mapping.title] ?? "").trim() : "");
  const plannedRows = (): RunRow[] => {
    const known = knownCreated();
    return [
      ...pendingUpdates.map((g): RunRow => ({ sku: g.sku, title: titleOf(g.rows[0].cells), action: "Update" })),
      ...pendingCreates.map((g): RunRow => ({ sku: g.sku, title: titleOf(g.rows[0].cells), action: known.has(g.sku) ? "Finish creating" : "Create" })),
      ...pendingShared.map((t): RunRow => ({ sku: t.key, label: t.group.sku, title: `${t.match.title} · shared SKU`, action: "Update" })),
    ];
  };

  const buildItems = (includeScanSkipped = false): { sku: string; item: ApplyItem }[] => {
    const known = knownCreated();
    const all = [
    ...pendingUpdates.map((g) => ({
      sku: g.sku,
      item: {
        kind: "update" as const,
        productId: g.matches[0].productId,
        variantId: g.matches[0].variantId,
        values: rowValues(g.rows[0].cells),
        metafields: rowMetafields(g.rows[0].cells),
        locationId: locationId || undefined,
        skipUnchanged,
      },
    })),
    ...pendingCreates.map((g) => {
      const existing = known.get(g.sku);
      const values = rowValues(g.rows[0].cells);
      const metafields = rowMetafields(g.rows[0].cells);
      const item: ApplyItem = existing
        ? { kind: "update", productId: existing.productId, variantId: existing.variantId, values, metafields, locationId: locationId || undefined, skipUnchanged }
        : { kind: "create", sku: g.sku, target: target as SkuTarget, values, metafields, locationId: locationId || undefined };
      return { sku: g.sku, item };
    }),
    ...pendingShared.map((t) => ({
      sku: t.key,
      item: {
        kind: "update" as const,
        productId: t.match.productId,
        variantId: t.match.variantId,
        values: rowValues(t.group.rows[0].cells),
        metafields: rowMetafields(t.group.rows[0].cells),
        locationId: locationId || undefined,
        skipUnchanged,
      },
    })),
    ];
    return includeScanSkipped ? all : all.filter(({ sku }) => !scanSkipped.has(sku));
  };

  /** What the first product in this run will receive — column by column — so a wrong mapping is visible before anything is written. */
  const previewRows = (): string[][] => {
    const first = buildItems()[0]?.item;
    if (!first) return [];
    const rows: string[][] = [];
    for (const field of APPLY_FIELDS) {
      const value = first.values[field.key];
      const column = (field.key === "status" && fixedStatus) || (field.key === "published" && (publishMode === "all" || publishMode === "none")) ? "(set for all rows)" : mapping[field.key] !== undefined ? headers[mapping[field.key] as number] : "";
      if (value !== undefined) rows.push([field.label, column, value.length > 80 ? `${value.slice(0, 80)}…` : value]);
    }
    for (const m of first.metafields ?? []) {
      const name = (definitions ?? []).find((d) => d.namespace === m.namespace && d.key === m.key)?.name ?? m.key;
      const definition = (definitions ?? []).find((d) => d.namespace === m.namespace && d.key === m.key);
      rows.push([`${name} (metafield)`, definition && metafieldFixed[definition.id] !== undefined ? "(written once for all products)" : definition && metafieldMapping[definition.id] !== undefined ? headers[metafieldMapping[definition.id]] : "", m.value.length > 80 ? `${m.value.slice(0, 80)}…` : m.value]);
    }
    return rows;
  };

  const verifyFirstResults = async (collected: RowOutcome[], itemsBySku: Map<string, ApplyItem>) => {
    // Failed rows that still created a product are the most useful to read back — they show what did and didn't land.
    const sample = [...collected.filter((o) => !o.result.ok && o.result.productId).slice(0, 2), ...collected.filter((o) => o.result.ok && o.result.productId).slice(0, 2)];
    if (sample.length === 0) return;
    setVerifying(true);
    const checked: { sku: string; checks: FieldCheck[] | null; error?: string }[] = [];
    for (const outcome of sample) {
      const item = itemsBySku.get(outcome.sku);
      if (!item) continue;
      try {
        const response = await verifyApplyAction(outcome.result.productId as string, outcome.result.variantId ?? null, item.values, item.metafields ?? [], item.locationId);
        checked.push(response.ok ? { sku: outcome.sku, checks: response.checks } : { sku: outcome.sku, checks: null, error: response.error });
      } catch {
        checked.push({ sku: outcome.sku, checks: null, error: "Couldn't read the product back." });
      }
    }
    setVerification(checked);
    setVerifying(false);
  };

  /** Runs every pending product — or, for a retry, only the given SKUs (their rows keep their place in the list). */
  const run = async (only?: ReadonlySet<string>) => {
    setConfirmOpen(false);
    setVerification([]);
    const items = buildItems().filter(({ sku }) => !only || only.has(sku));
    const itemsBySku = new Map(items.map(({ sku, item }) => [sku, item]));
    const snapshot = plannedRows().filter((row) => !only || only.has(row.sku));
    if (!only) setRunRows(snapshot);
    setRowStatus((prev) => {
      const next = { ...prev };
      for (const row of snapshot) if (!scanSkipped.has(row.sku)) next[row.sku] = { state: "waiting" };
      return next;
    });
    cancelRef.current = false;
    setCancelled(false);
    setStopping(false);
    setRunning(true);
    setOutcomes([]);
    setProgress({ done: 0, total: items.length });

    const collected: RowOutcome[] = [];
    await runApplyWorkers(
      items.map(({ sku, item }) => ({ key: sku, item })),
      {
        workers,
        shouldStop: () => cancelRef.current,
        onStart: (keys) => {
          setCurrentSku(keys[0] ?? null);
          setRowStatus((prev) => {
            const next = { ...prev };
            for (const key of keys) next[key] = { state: "running" };
            return next;
          });
        },
        onOutcomes: (batch) => {
          collected.push(...batch.map((o) => ({ sku: o.key, action: o.action, result: o.result })));
          setProgress({ done: collected.length, total: items.length });
          setRowStatus((prev) => {
            const next = { ...prev };
            for (const o of batch) {
              next[o.key] = o.result.ok
                ? { state: o.result.skipped ? "skipped" : "done", message: o.result.note ?? "Saved" }
                : { state: "failed", message: o.result.error ?? "Failed" };
            }
            return next;
          });
        },
      },
    );

    setCurrentSku(null);
    setCreatedBefore((prev) => {
      const next = new Map(prev);
      for (const o of collected) {
        if (o.action === "create" && o.result.productId) next.set(o.sku, { productId: o.result.productId, variantId: o.result.variantId ?? null });
      }
      return next;
    });
    setOutcomes(collected);
    setCancelled(cancelRef.current);
    setDoneSkus((prev) => {
      const next = new Set(prev);
      for (const o of collected) if (o.result.ok) next.add(o.sku);
      return next;
    });
    setRunning(false);
    void verifyFirstResults(collected, itemsBySku);
  };

  // Built only while the confirmation dialog is open (it walks every mapped field), and once per render.
  const previewTable = confirmOpen ? previewRows() : [];

  const failed = outcomes.filter((o) => !o.result.ok);
  const skippedCount = outcomes.filter((o) => o.result.ok && o.result.skipped).length;
  const updatedCount = outcomes.filter((o) => o.result.ok && !o.result.skipped && o.action === "update").length;
  const createdCount = outcomes.filter((o) => o.result.ok && o.action === "create").length;

  const downloadResults = () => {
    downloadCsv(
      buildCsv(
        ["SKU", "Action", "Result", "Details", "Product ID"],
        outcomes.map((o) => [
          o.sku,
          o.action === "update" ? "Update" : "Create",
          o.result.ok ? (o.result.skipped ? "Skipped (already up to date)" : "Success") : "Failed",
          o.result.error ?? o.result.note ?? "",
          o.result.productId ? idFromGid(o.result.productId) : "",
        ]).concat([...scanSkipped].map((key) => [key, "Update", "Skipped (already up to date)", "Found up to date by the check before the run.", ""])),
      ),
      "upload-products-results.csv",
    );
  };

  const mappedLabels = [
    ...APPLY_FIELDS.filter((f) => f.key !== "status" && f.key !== "published" && mapping[f.key] !== undefined).map((f) => f.label),
    ...(definitions ?? []).filter((d) => metafieldMapping[d.id] !== undefined || metafieldFixed[d.id] !== undefined).map((d) => `${d.name} (metafield)`),
    ...(fixedStatus ? [`Status (set to ${fixedStatus.toLowerCase()})`] : []),
    ...(publishMode === "all" ? ["Published (all sales channels)"] : publishMode === "none" ? ["Unpublished (all sales channels)"] : publishMode === "column" ? ["Published (from column)"] : []),
    ...(statusMode === "column" && mapping.status !== undefined ? ["Status (from column)"] : []),
  ];

  return (
    <Box padding="400" background="bg-surface-secondary" borderWidth="025" borderColor="border" borderRadius="300">
      <BlockStack gap="500">
        <BlockStack gap="100">
          <Text as="h3" variant="headingMd">What to write</Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Pick the CSV column for each product, variant or metafield value. Every field starts on &quot;Don&apos;t change&quot; unless a CSV header matched it. Fields left on that are never touched, and a blank cell never erases what&apos;s in the store.
          </Text>
        </BlockStack>

        <InlineStack align="space-between" blockAlign="center" gap="300">
          <InlineStack gap="200" blockAlign="center">
            <Badge tone={mappedCount > 0 ? "success" : undefined}>{`${mappedCount} field${mappedCount === 1 ? "" : "s"} will be written`}</Badge>
            <Text as="span" variant="bodySm" tone="subdued">Everything else is left unchanged.</Text>
          </InlineStack>
          <InlineStack gap="200">
            <Button variant="tertiary" disabled={running} onClick={() => { resetUploadSettings(); onResetSettings(); }}>Reset to defaults</Button>
            <Button variant="tertiary" tone="critical" disabled={running || mappedCount === 0} onClick={clearAllMappings}>Reset all to &quot;Don&apos;t change&quot;</Button>
          </InlineStack>
        </InlineStack>

        {(["product", "variant"] as const).map((group) => {
          const fields = APPLY_FIELDS.filter((field) => field.group === group && field.key !== "status" && field.key !== "published");
          const mappedInGroup = fields.filter((field) => mapping[field.key] !== undefined).length;
          return (
            <MappingSection
              key={group}
              id={`group-${group}`}
              title={GROUP_TITLES[group].title}
              description={GROUP_TITLES[group].description}
              mappedCount={mappedInGroup}
              totalCount={fields.length}
            >
              {fields.map((field) => (
                <MappingRow
                  key={field.key}
                  id={`field-${field.key}`}
                  label={field.label}
                  caption={field.hint || undefined}
                  options={columnOptions}
                  value={mapping[field.key] !== undefined ? String(mapping[field.key]) : ""}
                  onChange={(v) => changeField(field.key, v)}
                  sample={mapping[field.key] !== undefined ? (sampleRow[mapping[field.key] as number] ?? "") : undefined}
                  isAuto={autoFields.has(field.key)}
                  disabled={running}
                />
              ))}
              {group === "variant" && mapping.quantity !== undefined && (
                <Box paddingBlock="300">
                  <BlockStack gap="200">
                    {locationsError && <Banner tone="warning"><p>{`${locationsError} The access token needs the read_locations, read_inventory and write_inventory scopes to set stock.`}</p></Banner>}
                    <SearchableSelect
                      label="Stock location for the inventory quantity"
                      options={(locations ?? []).map((location) => ({ value: location.id, label: location.name }))}
                      value={locationId}
                      onChange={setLocationId}
                      loading={locations === null}
                      disabled={running || locations === null}
                      helpText="The quantity from your CSV becomes the available stock at this location (it replaces the current number). Inventory tracking is switched on for products that don't have it."
                    />
                  </BlockStack>
                </Box>
              )}
            </MappingSection>
          );
        })}

        <MetafieldMappingSection
          definitions={definitions}
          loading={definitions === null}
          error={definitionsError}
          columnOptions={columnOptions}
          mapping={metafieldMapping}
          autoMatchedIds={autoMetafieldIds}
          sampleRow={sampleRow}
          fixedContent={metafieldFixed}
          formats={metafieldFormat}
          onFixedChange={changeMetafieldFixed}
          onFormatChange={changeMetafieldFormat}
          onChange={changeMetafield}
          disabled={running}
        />

        <BlockStack gap="200">
          <Text as="h4" variant="headingSm">Status</Text>
          <ButtonGroup variant="segmented">
            {STATUS_MODES.map((mode) => (
              <Button key={mode.value} pressed={statusMode === mode.value} disabled={running} onClick={() => setStatusMode(mode.value)}>
                {mode.label}
              </Button>
            ))}
          </ButtonGroup>
          {statusMode === "column" && (
            <Box maxWidth="360px">
              <SearchableSelect
                label="Status column"
                options={columnOptions}
                value={mapping.status !== undefined ? String(mapping.status) : ""}
                onChange={(v) => changeField("status", v)}
                noneLabel="Don't change"
                disabled={running}
              />
            </Box>
          )}
          <Text as="p" variant="bodySm" tone="subdued">{STATUS_HINT[statusMode]}</Text>
        </BlockStack>

        <BlockStack gap="200">
          <Text as="h4" variant="headingSm">Published (sales channels)</Text>
          <ButtonGroup variant="segmented">
            {PUBLISH_MODES.map((mode) => (
              <Button key={mode.value} pressed={publishMode === mode.value} disabled={running} onClick={() => setPublishMode(mode.value)}>
                {mode.label}
              </Button>
            ))}
          </ButtonGroup>
          {publishMode === "column" && (
            <Box maxWidth="360px">
              <SearchableSelect
                label="Published column"
                options={columnOptions}
                value={mapping.published !== undefined ? String(mapping.published) : ""}
                onChange={(v) => changeField("published", v)}
                noneLabel="Don't change"
                disabled={running}
              />
            </Box>
          )}
          <Text as="p" variant="bodySm" tone="subdued">{PUBLISH_HINT[publishMode]}</Text>
        </BlockStack>

        {blockedNewCount > 0 && (
          <Banner tone="warning">
            <p>
              {target === null
                ? `${blockedNewCount.toLocaleString()} new products can't be created: new products can only store their SKU in the variant SKU or a single-line text metafield.`
                : `Map a Title column to create the ${blockedNewCount.toLocaleString()} new products — they're skipped until then.`}
            </p>
          </Banner>
        )}

        <SharedSkusPanel groups={sharedGroups} headers={headers} include={includeShared} onIncludeChange={setIncludeShared} disabled={running} />

        <Checkbox
          label="Skip products that are already up to date"
          helpText="Before writing, each product is compared with the store. Products whose values (quantity, price, metafields…) already match your CSV are skipped and counted as up to date; only what differs is written."
          checked={skipUnchanged}
          onChange={setSkipUnchanged}
          disabled={running}
        />

        <InlineStack gap="300" blockAlign="center">
          <Button
            loading={scan.state.running}
            disabled={running || scan.state.running || readyCount + scanSkippedCount === 0 || mappedCount === 0}
            onClick={() => void scan.start(buildItems(true), scanSignature)}
          >
            Check what&apos;s already up to date
          </Button>
          {scan.state.running && (
            <>
              <Text as="span" variant="bodySm" tone="subdued">{`Checked ${scan.state.checked.toLocaleString()} of ${scan.state.total.toLocaleString()} · ${scan.state.upToDate.size.toLocaleString()} already up to date`}</Text>
              <Button variant="tertiary" onClick={scan.stop}>Stop checking</Button>
            </>
          )}
          {!scan.state.running && scan.state.signature !== null && (
            <Text as="span" variant="bodySm" tone={scan.state.error ? "critical" : scanSkipped === NO_KEYS ? "caution" : "success"}>
              {scan.state.error
                ? `The check stopped: ${scan.state.error}`
                : scanSkipped === NO_KEYS
                  ? "Your column choices changed since the check — run it again."
                  : scan.state.checked < scan.state.total
                    ? `Stopped after checking ${scan.state.checked.toLocaleString()} of ${scan.state.total.toLocaleString()} — ${scanSkippedCount.toLocaleString()} of those are already up to date and will be skipped.`
                    : `${scanSkippedCount.toLocaleString()} of ${scan.state.total.toLocaleString()} products are already up to date and will be skipped.`}
            </Text>
          )}
        </InlineStack>

        {!scan.state.running && scanSkipped !== NO_KEYS && scan.state.reasons.length > 0 && (
          <Banner tone="info" title="What keeps products from being up to date">
            <BlockStack gap="100">
              {scan.state.reasons.slice(0, 5).map((reason) => (
                <Text as="p" variant="bodySm" key={reason.label}>
                  {`${reason.label}: ${reason.count.toLocaleString()} ${reason.count === 1 ? "product" : "products"} — e.g. ${reason.sample.sku}: CSV "${reason.sample.expected}", store "${reason.sample.actual}"`}
                </Text>
              ))}
            </BlockStack>
          </Banner>
        )}

        <InlineStack gap="300" blockAlign="center">
          <WorkersField value={workers} onChange={setWorkers} max={MAX_WORKERS} disabled={running} helpText={`Products uploaded at the same time (1–${MAX_WORKERS})`} />
          <Button variant="primary" size="large" icon={ImportIcon} disabled={running || scan.state.running || readyCount === 0 || mappedCount === 0} onClick={() => setConfirmOpen(true)}>
            {nothingToUpdate
              ? "Nothing to update — all up to date"
              : doneSkus.size > 0
                ? `Resume Upload & Update (${readyCount.toLocaleString()} remaining)`
                : includeShared && sharedToUpdateCount > 0
                  ? `Upload & Update (${readyCount.toLocaleString()} products, shared SKUs included)`
                  : `Upload & Update (${readyCount.toLocaleString()} ${readyCount === 1 ? "product" : "products"})`}
          </Button>
          <Text as="span" variant="bodySm" tone="subdued">
            {mappedCount === 0
              ? "Map at least one field to write."
              : `${toUpdateCount.toLocaleString()} to update · ${toCreateCount.toLocaleString()} to upload as new` +
                (scanSkippedCount > 0 ? ` · ${scanSkippedCount.toLocaleString()} already up to date (skipped)` : "") +
                (includeShared ? ` · ${sharedToUpdateCount.toLocaleString()} shared-SKU products to update` : sharedCount > 0 ? ` · ${sharedCount.toLocaleString()} shared SKU${sharedCount === 1 ? "" : "s"} skipped` : "") +
                (untickedCount > 0 ? ` · ${untickedCount.toLocaleString()} unticked` : "")}
          </Text>
        </InlineStack>

        {runRows.length > 0 && <RunSummary rows={runRows} statuses={shownStatuses} running={running} />}

        {running && (
          <BlockStack gap="200">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="p" variant="bodySm" tone="subdued">{`Uploading with ${workers} worker${workers === 1 ? "" : "s"} — ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()} in this run`}</Text>
              <Button
                variant="tertiary"
                tone="critical"
                disabled={stopping}
                loading={stopping}
                onClick={() => {
                  cancelRef.current = true;
                  setStopping(true);
                }}
              >
                {stopping ? "Stopping after the products in progress…" : "Stop"}
              </Button>
            </InlineStack>
          </BlockStack>
        )}

        {!running && outcomes.length > 0 && (
          <BlockStack gap="300">
            <Banner tone={failed.length === 0 ? "success" : "warning"} title={cancelled ? "Stopped early" : "Finished"}>
              <p>
                {`${updatedCount.toLocaleString()} updated · ${createdCount.toLocaleString()} created · ${(skippedCount + scanSkippedCount).toLocaleString()} already up to date (skipped) · ${failed.length.toLocaleString()} failed`}
                {cancelled ? " — the rest were not processed." : ""}
              </p>
              {failed.length > 0 && <p>{`Why: ${failed[0].result.error ?? "unknown"}`}</p>}
            </Banner>
            <InlineStack gap="200">
              <Button onClick={downloadResults}>Download results CSV</Button>
            </InlineStack>
            {verifying && <Banner tone="info"><p>Reading the first products back from your store to confirm the values were saved…</p></Banner>}
            {verification.map((entry) => {
              const mismatches = entry.checks?.filter((c) => !c.ok) ?? [];
              return (
                <BlockStack key={entry.sku} gap="200">
                  <Banner
                    tone={entry.checks === null ? "warning" : mismatches.length === 0 ? "success" : "critical"}
                    title={`Read back from the store: ${entry.sku}`}
                  >
                    <p>
                      {entry.checks === null
                        ? entry.error
                        : mismatches.length === 0
                          ? `All ${entry.checks.length} values match what the CSV said to write.`
                          : `${mismatches.length} of ${entry.checks.length} values are not what the CSV said — see below.`}
                    </p>
                  </Banner>
                  {entry.checks !== null && (
                    <DataTable
                      columnContentTypes={["text", "text", "text", "text"]}
                      headings={["Field", "CSV value", "In your store", ""]}
                      rows={entry.checks.map((c) => [c.label, c.expected.slice(0, 60), c.actual.slice(0, 60), c.ok ? "✓" : "✗ differs"])}
                      truncate
                    />
                  )}
                </BlockStack>
              );
            })}
            {failed.length > 0 && (
              <DataTable
                columnContentTypes={["text", "text", "text"]}
                headings={["SKU", "Action", "Why it failed"]}
                rows={failed.slice(0, 50).map((o) => [o.sku, o.action === "update" ? "Update" : "Create", o.result.error ?? ""])}
              />
            )}
          </BlockStack>
        )}

        <RunStatusList rows={runRows.length > 0 ? runRows : plannedRows()} statuses={shownStatuses} running={running} currentSku={currentSku} onRetry={(skus) => void run(new Set(skus))} />
      </BlockStack>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`Upload & Update ${readyCount.toLocaleString()} products?`}
        primaryAction={{ content: `Upload & Update (${readyCount.toLocaleString()})`, onAction: () => void run() }}
        secondaryActions={[{ content: "Cancel", onAction: () => setConfirmOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p">
              This changes <Text as="span" fontWeight="semibold">{storeName || "your store"}</Text> right away:
            </Text>
            <InlineStack gap="200">
              <Badge tone="success">{`${pendingUpdates.length.toLocaleString()} existing products updated`}</Badge>
              <Badge tone="info">
                {`${pendingCreates.length.toLocaleString()} new products created${
                  fixedStatus ? ` as ${fixedStatus.toLowerCase()}` : statusMode === "column" ? " (status from your column, draft if blank)" : " as drafts"
                }`}
              </Badge>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">{`Fields written: ${mappedLabels.join(", ")}.`}</Text>
            {previewTable.length > 0 && (
              <BlockStack gap="100">
                <Text as="p" variant="headingSm">What the first product will receive</Text>
                <DataTable
                  columnContentTypes={["text", "text", "text"]}
                  headings={["Field", "From CSV column", "Value"]}
                  rows={previewTable}
                  truncate
                />
              </BlockStack>
            )}
            {confirmOpen && previewTable.length === 0 && (
              <Banner tone="warning"><p>The first row has no values for the mapped columns — nothing would be written for it. Check the column choices above.</p></Banner>
            )}
            {pendingUpdates.some((g) => g.matches[0].variantId === null) && APPLY_FIELDS.some((f) => mapping[f.key] !== undefined && isVariantField(f.key)) && (
              <Text as="p" variant="bodySm" tone="caution">
                Variant fields (SKU, price, barcode, weight, …) are skipped for products matched through a metafield.
              </Text>
            )}
            {includeShared && pendingShared.length > 0 && (
              <Banner tone="warning">
                <p>{`${pendingShared.length.toLocaleString()} store products that share a SKU will also be updated — each one gets the same values from its CSV row.`}</p>
              </Banner>
            )}
            <Text as="p" variant="bodySm" tone="subdued">{`${workers} worker${workers === 1 ? "" : "s"} will upload ${workers === 1 ? "one product at a time" : "products in parallel"}. If Shopify asks to slow down, each product is retried automatically.`}</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              There is no bulk undo. Each SKU is only sent once per session, so running again won&apos;t create duplicates.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Box>
  );
}
