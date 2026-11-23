"use client";

import { useMemo, useRef, useState } from "react";
import { Badge, Banner, BlockStack, Box, Button, Card, ChoiceList, Checkbox, DropZone, IndexTable, InlineGrid, InlineStack, Modal, Page, Text, TextField } from "@shopify/polaris";
import { Select } from "@/components/ui/Select";
import { StatTile } from "@/components/ui/StatTile";
import { buildCsv, downloadCsv } from "@/lib/csvExport";
import { parseCsvRows } from "@/lib/csvParsing";
import {
  BUILDER_TYPES,
  buildPlan,
  describeRemote,
  matchesRemote,
  type RemoteField,
  distinctTypeLabels,
  guessMapping,
  guessType,
  NO_COLUMN,
  parseMetafieldKey,
  parsePastedFields,
  slugFromName,
  toShopifyType,
  type ColumnMapping,
  type OwnerType,
  type SingleObjectOptions,
} from "@/lib/metaobjectBuilder";
import type { ActivityEntry, ActivityMetafield, ActivityObject, SavedFile } from "@/lib/metaobjectBuilderStore";
import { BuilderHistory } from "./BuilderHistory";
import {
  createMetafieldDefinitionAction,
  createObjectDefinitionAction,
  makeFieldsImageOnlyAction,
  readObjectDefinitionAction,
  readSavedFileAction,
  recordActivityAction,
  saveSourceFileAction,
} from "./actions";

type Mode = "multi" | "single";
type Source = "csv" | "paste";
type StepState = "waiting" | "running" | "created" | "existed" | "failed" | "skipped";

interface Step {
  state: StepState;
  message?: string;
}

interface Role {
  key: keyof ColumnMapping;
  label: string;
  help: string;
  optional: boolean;
  /** Only needed when the file holds many objects. */
  multiOnly?: boolean;
}

const ROLES: Role[] = [
  { key: "objectKey", label: "Object (definition) key", help: "The metaobject type, e.g. showcase_banner.", optional: false, multiOnly: true },
  { key: "fieldName", label: "Field name", help: "The label shown in Shopify.", optional: false },
  { key: "fieldKey", label: "Field key", help: "The field's handle, e.g. banner_image.", optional: false },
  { key: "fieldType", label: "Field type", help: "Text, rich text, file (image)…", optional: false },
  { key: "metafieldKey", label: "Metafield key", help: "namespace.key of the metafield that points at the object. Leave empty to skip metafields.", optional: true, multiOnly: true },
  { key: "blockName", label: "Metafield name", help: "A readable name for each metafield (otherwise made from its key).", optional: true, multiOnly: true },
];

/** A pasted list is always name | key | type. */
const PASTE_MAPPING: ColumnMapping = { objectKey: NO_COLUMN, fieldName: 0, fieldKey: 1, fieldType: 2, metafieldKey: NO_COLUMN, blockName: NO_COLUMN };
const PASTE_PLACEHOLDER = "Banner image | banner_image | File (image)\nIntro title | intro_title | Single line text\nIntro text | intro_text | Rich text";

const OWNER_LABEL: Record<OwnerType, string> = { PRODUCT: "Products", COLLECTION: "Collections" };
const TYPE_OPTIONS = [{ label: "Choose a type…", value: "" }, ...BUILDER_TYPES.map((type) => ({ label: type.label, value: type.value }))];
const typeLabel = (value: string): string => BUILDER_TYPES.find((type) => type.value === value)?.label ?? value;

/** The type as Shopify names it, e.g. "file_reference (images only)". */
function shopifyTypeText(value: string): string {
  const shopify = toShopifyType(value);
  if (!shopify) return value;
  return shopify.validations.length > 0 ? `${shopify.type} (${value.endsWith(":video") ? "videos" : "images"} only)` : shopify.type;
}

const STEP_BADGE: Record<StepState, { label: string; tone: "success" | "info" | "critical" | "attention" | undefined }> = {
  waiting: { label: "Waiting", tone: undefined },
  running: { label: "Creating…", tone: "info" },
  created: { label: "Created", tone: "success" },
  existed: { label: "Already existed", tone: "attention" },
  failed: { label: "Failed", tone: "critical" },
  skipped: { label: "Skipped", tone: undefined },
};

function StepBadge({ step }: { step: Step }) {
  return (
    <BlockStack gap="100">
      <InlineStack>
        <Badge tone={STEP_BADGE[step.state].tone}>{STEP_BADGE[step.state].label}</Badge>
      </InlineStack>
      {step.message && (
        <Text as="span" variant="bodySm" tone={step.state === "failed" ? "critical" : "subdued"}>
          {step.message}
        </Text>
      )}
    </BlockStack>
  );
}

/** What this tool needs from the access key: metaobject definitions, plus products (the metafield lives on products or collections). */
const REQUIRED_SCOPES = ["write_metaobject_definitions", "write_products"];

export function MetaobjectBuilder({ grantedScopes }: { grantedScopes: string[] | null }) {
  const [mode, setMode] = useState<Mode>("single");
  const [source, setSource] = useState<Source>("paste");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({ ...PASTE_MAPPING, fieldName: NO_COLUMN, fieldKey: NO_COLUMN, fieldType: NO_COLUMN });
  const [autoMapped, setAutoMapped] = useState<ColumnMapping | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [typeChoices, setTypeChoices] = useState<Record<string, string>>({});
  const [objectNames, setObjectNames] = useState<Record<string, string>>({});
  const [fieldNames, setFieldNames] = useState<Record<string, string>>({});
  // One-object settings: the handle follows the name until it is edited by hand.
  const [singleName, setSingleName] = useState("Product showcase");
  const [handleText, setHandleText] = useState("");
  const [handleEdited, setHandleEdited] = useState(false);
  const [makeMetafield, setMakeMetafield] = useState(true);
  const [metafieldKeyText, setMetafieldKeyText] = useState("custom.showcase");
  const [metafieldName, setMetafieldName] = useState("");
  const [ownerType, setOwnerType] = useState<OwnerType>("PRODUCT");
  const [storefront, setStorefront] = useState(true);
  const [autoMetafields, setAutoMetafields] = useState(false);
  const [steps, setSteps] = useState<Record<string, Step>>({});
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  // What Shopify actually holds for each definition, read back after creating (or on request).
  const [remote, setRemote] = useState<Record<string, RemoteField[]>>({});
  const [checking, setChecking] = useState(false);
  const [fixingPickers, setFixingPickers] = useState(false);
  const [remoteMessage, setRemoteMessage] = useState<string | null>(null);
  // The saved copy of the file in use (so a run can be logged with it), and a counter that reloads the lists below.
  const [sourceFileId, setSourceFileId] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const stopRef = useRef(false);

  const single = mode === "single";
  const usingPaste = single && source === "paste";
  const pasted = useMemo(() => parsePastedFields(pasteText), [pasteText]);
  const dataRows = usingPaste ? pasted.rows : rows;
  const dataMapping = usingPaste ? PASTE_MAPPING : mapping;

  const objectHandle = handleEdited ? handleText : slugFromName(singleName);
  const parsedMetafield = parseMetafieldKey(metafieldKeyText);
  const singleOptions = useMemo<SingleObjectOptions | undefined>(
    () => (single ? { type: objectHandle, name: singleName, metafield: makeMetafield && parsedMetafield ? { ...parsedMetafield, name: metafieldName } : null } : undefined),
    [single, objectHandle, singleName, makeMetafield, parsedMetafield, metafieldName],
  );

  /** Keeps an uploaded file on the server; remembers its saved id so the run can be logged with it. */
  const persistFile = async (name: string, kind: SavedFile["kind"], content: string) => {
    const response = await saveSourceFileAction(name, kind, content).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
    if (response.ok) {
      setSourceFileId(response.file.id);
      setSaveNotice(null);
      setHistoryKey((key) => key + 1);
    } else {
      setSourceFileId(null);
      setSaveNotice(response.error);
    }
  };

  const loadCsvText = (name: string, text: string): boolean => {
    setReadError(null);
    const parsed = parseCsvRows(text).filter((cells) => cells.some((c) => c.trim()));
    if (parsed.length < 2) {
      setReadError("That file has no rows under its header line.");
      return false;
    }
    const [head, ...body] = parsed;
    const guessed = guessMapping(head);
    setFileName(name);
    setHeaders(head);
    setRows(body);
    setMapping(guessed);
    setAutoMapped(guessed);
    setTypeChoices({});
    setObjectNames({});
    setFieldNames({});
    setSteps({});
    setFinished(false);
    return true;
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    if (loadCsvText(file.name, text)) void persistFile(file.name, "csv", text);
  };

  const clearFile = () => {
    setFileName("");
    setHeaders([]);
    setRows([]);
    setAutoMapped(null);
    setTypeChoices({});
    setFieldNames({});
    setSteps({});
    setFinished(false);
    setReadError(null);
  };

  /** A dropped text file fills the pasted list (so a list kept in a file works the same as typing it). */
  const readListFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setPasteText(text);
    setSteps({});
    setFinished(false);
    void persistFile(file.name, "list", text);
  };

  /** Attaches a saved file again: a field list goes back into the list box, a CSV is read like a fresh upload. */
  const attachSavedFile = (file: { id: string; name: string; kind: SavedFile["kind"]; content: string }) => {
    setSourceFileId(file.id);
    if (file.kind === "list") {
      setMode("single");
      setSource("paste");
      setPasteText(file.content);
      setSteps({});
      setFinished(false);
    } else {
      setSource("csv");
      loadCsvText(file.name, file.content);
    }
  };

  /** Puts a past run's file and settings back on the page, ready to review and create again. */
  const runAgain = async (entry: ActivityEntry) => {
    const { settings } = entry;
    setMode(settings.mode);
    setSource(settings.source);
    setSingleName(settings.singleName);
    setHandleText(settings.handle);
    setHandleEdited(settings.handle !== slugFromName(settings.singleName));
    setMakeMetafield(settings.makeMetafield);
    setMetafieldKeyText(settings.metafieldKey);
    setMetafieldName(settings.metafieldName);
    setOwnerType(settings.ownerType);
    setStorefront(settings.storefront);
    setSteps({});
    setFinished(false);
    if (!entry.fileId) return setSaveNotice("That run's file wasn't saved, so attach the file again.");
    const response = await readSavedFileAction(entry.fileId);
    if (!response.ok) return setSaveNotice("That run's file is no longer saved, so attach the file again.");
    attachSavedFile({ id: response.file.id, name: response.file.name, kind: response.file.kind, content: response.content });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const typeLabels = useMemo(() => distinctTypeLabels(dataRows, dataMapping.fieldType), [dataRows, dataMapping.fieldType]);
  // Each file type label resolves to the user's pick, else the automatic guess, else nothing yet.
  const resolvedTypes = useMemo(() => Object.fromEntries(typeLabels.map((label) => [label, typeChoices[label] ?? guessType(label) ?? ""])), [typeLabels, typeChoices]);
  const plan = useMemo(
    () => buildPlan(dataRows, dataMapping, { typeChoices: resolvedTypes, autoMetafields: !single && autoMetafields, objectNames, fieldNames, single: singleOptions }),
    [dataRows, dataMapping, resolvedTypes, single, autoMetafields, objectNames, fieldNames, singleOptions],
  );

  const roles = ROLES.filter((role) => !single || !role.multiOnly);
  const columnOptions = [{ label: "— Don't use —", value: String(NO_COLUMN) }, ...headers.map((header, index) => ({ label: header, value: String(index) }))];
  const requiredMissing = !usingPaste && roles.some((role) => !role.optional && mapping[role.key] === NO_COLUMN);
  const unmappedTypes = typeLabels.filter((label) => !resolvedTypes[label]);
  const metafieldProblem = single && makeMetafield && !parsedMetafield ? "Use the form namespace.key, e.g. custom.showcase." : null;
  const hasInput = dataRows.length > 0;
  // null means the scopes couldn't be read, in which case nothing is blocked up front and Shopify's own answer is shown.
  const missingScopes = grantedScopes ? REQUIRED_SCOPES.filter((scope) => !grantedScopes.includes(scope)) : [];
  const canRun = !running && hasInput && !requiredMissing && unmappedTypes.length === 0 && plan.objects.length > 0 && !metafieldProblem && missingScopes.length === 0;
  const metafieldCount = plan.metafields.length;

  const refreshRemote = async (types: string[]) => {
    const found: Record<string, RemoteField[]> = {};
    for (const type of types) {
      const response = await readObjectDefinitionAction(type).catch(() => null);
      if (response?.ok) found[type] = response.fields;
    }
    setRemote((prev) => ({ ...prev, ...found }));
    return found;
  };

  const checkInShopify = async () => {
    setChecking(true);
    setRemoteMessage(null);
    const found = await refreshRemote(plan.objects.map((object) => object.type));
    setChecking(false);
    if (Object.keys(found).length === 0) setRemoteMessage("None of these definitions exist in the store yet, so there is nothing to check.");
  };

  /** Planned image/video/file fields whose Shopify counterpart is not what was planned. */
  const mismatches = plan.objects.flatMap((object) =>
    object.fields.filter((field) => field.type.startsWith("file_reference") && remote[object.type] && !matchesRemote(field.type, remote[object.type]?.find((r) => r.key === field.key))).map((field) => ({ object: object.type, key: field.key, type: field.type })),
  );
  const imageMismatches = mismatches.filter((entry) => entry.type === "file_reference:image");

  const makeImageOnly = async () => {
    setFixingPickers(true);
    setRemoteMessage(null);
    const byObject = new Map<string, string[]>();
    for (const entry of imageMismatches) byObject.set(entry.object, [...(byObject.get(entry.object) ?? []), entry.key]);
    let failure: string | null = null;
    for (const [type, keys] of byObject) {
      const result = await makeFieldsImageOnlyAction(type, keys).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
      if (!result.ok) failure = result.error;
    }
    await refreshRemote([...byObject.keys()]);
    setFixingPickers(false);
    setRemoteMessage(failure ? `Some fields couldn't be changed: ${failure}` : "Those fields now use the image picker.");
  };

  const setStep = (id: string, step: Step) => setSteps((prev) => ({ ...prev, [id]: step }));
  const stepOf = (id: string): Step => steps[id] ?? { state: "waiting" };

  const run = async () => {
    setConfirmOpen(false);
    stopRef.current = false;
    setFinished(false);
    setRunning(true);
    setSteps(Object.fromEntries([...plan.objects.map((o) => [`object:${o.type}`, { state: "waiting" }]), ...plan.metafields.map((m) => [`meta:${m.namespace}.${m.key}`, { state: "waiting" }])]));

    const loggedObjects: ActivityObject[] = [];
    const loggedMetafields: ActivityMetafield[] = [];

    for (const object of plan.objects) {
      if (stopRef.current) break;
      const objectId = `object:${object.type}`;
      setStep(objectId, { state: "running" });
      const created = await createObjectDefinitionAction(object, storefront).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
      if (!created.ok) {
        setStep(objectId, { state: "failed", message: created.error });
        for (const metafield of plan.metafields.filter((m) => m.objectType === object.type)) {
          setStep(`meta:${metafield.namespace}.${metafield.key}`, { state: "skipped", message: "Its metaobject definition wasn't created." });
        }
        continue;
      }
      setStep(objectId, { state: created.existed ? "existed" : "created", message: created.existed ? "A definition with this key already exists — it was reused, and its fields were not changed." : undefined });
      loggedObjects.push({ type: object.type, name: object.name, id: created.id, created: !created.existed, fieldCount: object.fields.length });
      await refreshRemote([object.type]);

      for (const metafield of plan.metafields.filter((m) => m.objectType === object.type)) {
        if (stopRef.current) break;
        const metaId = `meta:${metafield.namespace}.${metafield.key}`;
        setStep(metaId, { state: "running" });
        const result = await createMetafieldDefinitionAction(metafield, created.id, ownerType, storefront).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
        setStep(metaId, result.ok ? { state: result.existed ? "existed" : "created", message: result.existed ? "This metafield already exists." : undefined } : { state: "failed", message: result.error });
        if (result.ok) loggedMetafields.push({ namespace: metafield.namespace, key: metafield.key, ownerType, id: result.id, created: !result.existed });
      }
    }
    setRunning(false);
    setFinished(true);

    if (loggedObjects.length > 0) {
      // A pasted list is saved with the run, so "Run again" has something to load.
      let fileId = sourceFileId;
      if (!fileId && usingPaste && pasteText.trim()) {
        const saved = await saveSourceFileAction("pasted-field-list.txt", "list", pasteText).catch(() => null);
        fileId = saved?.ok ? saved.file.id : null;
      }
      const first = loggedObjects[0];
      const label = single
        ? `Created "${first.name}" (${first.fieldCount} fields)${loggedMetafields[0] ? ` and the ${loggedMetafields[0].namespace}.${loggedMetafields[0].key} metafield on ${OWNER_LABEL[ownerType].toLowerCase()}` : ""}`
        : `Created ${loggedObjects.length} definitions and ${loggedMetafields.length} ${OWNER_LABEL[ownerType].toLowerCase()} metafields`;
      const logged = await recordActivityAction({
        label,
        settings: { mode, source, singleName, handle: objectHandle, makeMetafield, metafieldKey: metafieldKeyText, metafieldName, ownerType, storefront },
        fileId,
        objects: loggedObjects,
        metafields: loggedMetafields,
      }).catch(() => null);
      if (logged && !logged.ok) setSaveNotice(logged.error);
      setHistoryKey((key) => key + 1);
    }
  };

  const tally = useMemo(() => {
    const counts: Record<StepState, number> = { waiting: 0, running: 0, created: 0, existed: 0, failed: 0, skipped: 0 };
    for (const step of Object.values(steps)) counts[step.state] += 1;
    return counts;
  }, [steps]);

  const downloadFields = () =>
    downloadCsv(
      buildCsv(["Object", "Field name", "Field key", "Type", "Shopify type"], plan.objects.flatMap((object) => object.fields.map((field) => [object.type, field.name, field.key, typeLabel(field.type), shopifyTypeText(field.type)]))),
      "metaobject-fields.csv",
    );

  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const object of plan.objects) for (const field of object.fields) counts.set(field.name, (counts.get(field.name) ?? 0) + 1);
    return [...counts].filter(([, count]) => count > 1).map(([name]) => name);
  }, [plan.objects]);

  const singleObject = single ? plan.objects[0] : undefined;

  const createLabel = `Create ${plan.objects.length} ${plan.objects.length === 1 ? "definition" : "definitions"}${metafieldCount > 0 ? ` and ${metafieldCount} ${OWNER_LABEL[ownerType].toLowerCase()} ${metafieldCount === 1 ? "metafield" : "metafields"}` : ""}`;
  const createButton = (
    <Button variant="primary" onClick={() => setConfirmOpen(true)} disabled={!canRun} loading={running}>
      {createLabel}
    </Button>
  );
  const blockedReason = missingScopes.length > 0 ? `Your access key is missing ${missingScopes.join(", ")} — see the notice at the top.` : requiredMissing ? "Choose the required columns first." : unmappedTypes.length > 0 ? "Choose a type for each field type above." : (metafieldProblem ?? "Nothing to create yet.");

  return (
    <Page fullWidth title="Metaobject & metafield builder" subtitle="Create metaobject definitions and the metafields that point at them in bulk, from a CSV or a pasted list of fields.">
      <BlockStack gap="400">
        {missingScopes.length > 0 && (
          <Banner tone="critical" title="Your access key can't create these yet" action={{ content: "Reconnect with a new key", url: "/connect/token" }}>
            <BlockStack gap="200">
              <p>{`Shopify refuses this until the key has: ${missingScopes.join(", ")}.`}</p>
              <p>In Shopify admin open Settings → Apps and sales channels → Develop apps → your app → Configuration → Admin API scopes, tick the scope above, save, then install the app again and paste the new access key on the reconnect page.</p>
            </BlockStack>
          </Banner>
        )}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">1. What are you creating?</Text>
            <ChoiceList
              title="Your fields describe"
              titleHidden
              choices={[
                { label: "One metaobject definition", value: "single", helpText: "Every row is a field of the same object. You name the object here." },
                { label: "Several metaobject definitions", value: "multi", helpText: "The file has a column saying which object each field belongs to." },
              ]}
              selected={[mode]}
              onChange={(value) => {
                setMode((value[0] as Mode) ?? "single");
                setSteps({});
                setFinished(false);
              }}
              disabled={running}
            />

            {single && (
              <>
                <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                  <TextField
                    label="Object name"
                    value={singleName}
                    onChange={(value) => {
                      // A handle that still equals the old name's slug was never customised, so it keeps following the name.
                      if (handleEdited && handleText === slugFromName(singleName)) setHandleEdited(false);
                      setSingleName(value);
                    }}
                    autoComplete="off"
                    disabled={running}
                  />
                  <TextField
                    label="Type / handle"
                    value={objectHandle}
                    onChange={(value) => {
                      setHandleText(value);
                      setHandleEdited(true);
                    }}
                    autoComplete="off"
                    helpText="Made from the name; lowercase letters, numbers, - and _."
                    disabled={running}
                  />
                </InlineGrid>
                <ChoiceList
                  title="Where do the fields come from?"
                  choices={[
                    { label: "Paste a list", value: "paste", helpText: "One field per line:  Name | key | Type" },
                    { label: "A CSV file", value: "csv" },
                  ]}
                  selected={[source]}
                  onChange={(value) => setSource((value[0] as Source) ?? "paste")}
                  disabled={running}
                />
              </>
            )}

            {saveNotice && <Banner tone="warning" onDismiss={() => setSaveNotice(null)}><p>{saveNotice}</p></Banner>}
            {usingPaste ? (
              <>
                <TextField label="Fields" labelHidden value={pasteText} onChange={setPasteText} multiline={10} autoComplete="off" monospaced placeholder={PASTE_PLACEHOLDER} disabled={running} />
                <DropZone accept=".txt,.csv,text/plain,text/csv" type="file" disabled={running} onDrop={(_files, accepted) => void readListFile(accepted[0])}>
                  <DropZone.FileUpload actionTitle="Add file" actionHint="or drop a text file with one field per line" />
                </DropZone>
                <Text as="p" tone="subdued">{`${pasted.rows.length} fields read${pasted.skipped.length > 0 ? `, ${pasted.skipped.length} lines skipped (each needs three parts separated by |)` : ""}.`}</Text>
              </>
            ) : (
              <>
                <Text as="p" tone="subdued">One row per field: its name, key and type{single ? "" : " — and the object it belongs to, plus optionally the metafield key that points at it"}.</Text>
                <DropZone accept=".csv,text/csv,text/plain" type="file" disabled={running} onDrop={(_files, accepted) => void readFile(accepted[0])}>
                  <DropZone.FileUpload actionTitle={fileName ? "Choose another file" : "Add file"} actionHint="or drop a CSV to upload" />
                </DropZone>
                {fileName && (
                  <InlineStack gap="300" blockAlign="center">
                    <Badge tone="success">{fileName}</Badge>
                    <Text as="span" tone="subdued">{`${rows.length.toLocaleString()} rows read`}</Text>
                    <Button variant="tertiary" tone="critical" onClick={clearFile} disabled={running}>Remove</Button>
                  </InlineStack>
                )}
                {readError && <Banner tone="critical"><p>{readError}</p></Banner>}
              </>
            )}
          </BlockStack>
        </Card>

        {!usingPaste && rows.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">2. Which column is which?</Text>
                <Button variant="tertiary" onClick={() => setMapping(guessMapping(headers))} disabled={running}>Auto-detect again</Button>
              </InlineStack>
              <Text as="p" tone="subdued">Columns are picked from their headers; change any of them if a pick is wrong.</Text>
              <InlineGrid columns={{ xs: 1, sm: 2, lg: 3 }} gap="300">
                {roles.map((role) => (
                  <Select
                    key={role.key}
                    label={`${role.label}${role.optional ? " (optional)" : ""}`}
                    options={columnOptions}
                    value={String(mapping[role.key])}
                    onChange={(value) => setMapping((prev) => ({ ...prev, [role.key]: Number(value) }))}
                    helpText={autoMapped && mapping[role.key] === autoMapped[role.key] && mapping[role.key] !== NO_COLUMN ? `Auto-detected — ${role.help}` : role.help}
                    error={!role.optional && mapping[role.key] === NO_COLUMN ? "Choose a column." : undefined}
                    disabled={running}
                  />
                ))}
              </InlineGrid>
            </BlockStack>
          </Card>
        )}

        {typeLabels.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">3. Field types</Text>
              <Text as="p" tone="subdued">Each type found and the Shopify type it becomes. Known names are matched automatically.</Text>
              <InlineGrid columns={{ xs: 1, sm: 2, lg: 3 }} gap="300">
                {typeLabels.map((label) => (
                  <Select
                    key={label}
                    label={`“${label}” becomes`}
                    options={TYPE_OPTIONS}
                    value={resolvedTypes[label] ?? ""}
                    onChange={(value) => setTypeChoices((prev) => ({ ...prev, [label]: value }))}
                    helpText={typeChoices[label] === undefined && guessType(label) ? "Auto-detected" : undefined}
                    error={resolvedTypes[label] ? undefined : "Choose a type for this."}
                    disabled={running}
                  />
                ))}
              </InlineGrid>
            </BlockStack>
          </Card>
        )}

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">4. The metafield and access</Text>
            {single && (
              <Checkbox label="Create a metafield that points at this object (type: metaobject reference, one entry)" checked={makeMetafield} onChange={setMakeMetafield} disabled={running} />
            )}
            {single && makeMetafield && (
              <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                <TextField label="Namespace and key" value={metafieldKeyText} onChange={setMetafieldKeyText} autoComplete="off" error={metafieldProblem ?? undefined} placeholder="custom.showcase" disabled={running} />
                <TextField label="Metafield name" value={metafieldName} onChange={setMetafieldName} autoComplete="off" placeholder={singleName || "Same as the object"} helpText="Shown in the Shopify admin — you can change it any time." disabled={running} />
              </InlineGrid>
            )}
            <ChoiceList
              title="Create the metafield for"
              choices={[
                { label: "Products", value: "PRODUCT", helpText: "The metafield appears on every product and points at one metaobject entry." },
                { label: "Collections", value: "COLLECTION", helpText: "The same, on collections instead." },
              ]}
              selected={[ownerType]}
              onChange={(value) => setOwnerType((value[0] as OwnerType) ?? "PRODUCT")}
              disabled={running}
            />
            <Checkbox label="Storefront access on the definition and the metafield" helpText="Lets the Storefront API (and headless sites) read them. Themes read them either way." checked={storefront} onChange={setStorefront} disabled={running} />
            {!single && mapping.metafieldKey === NO_COLUMN && (
              <Checkbox label="Also create a metafield for every object, named custom.<object key>" helpText="No metafield column is chosen, so this makes one metafield per object." checked={autoMetafields} onChange={setAutoMetafields} disabled={running} />
            )}
          </BlockStack>
        </Card>

        {hasInput && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">5. Review and create</Text>
              <div className="stat-grid">
                <StatTile label="Metaobject definitions" value={plan.objects.length} tone="info" />
                <StatTile label="Fields" value={plan.objects.reduce((sum, object) => sum + object.fields.length, 0)} tone="info" />
                <StatTile label={`${OWNER_LABEL[ownerType]} metafields`} value={metafieldCount} tone="info" />
                {plan.problems.length > 0 && <StatTile label="Rows with problems" value={plan.problems.length} tone="critical" />}
                {(running || finished) && <StatTile label="Created" value={tally.created} tone="success" />}
                {(running || finished) && <StatTile label="Already existed" value={tally.existed} tone="caution" />}
                {(running || finished) && <StatTile label="Failed" value={tally.failed} tone={tally.failed > 0 ? "critical" : "neutral"} />}
              </div>

              {plan.problems.length > 0 && (
                <Banner tone="warning" title={`${plan.problems.length} ${plan.problems.length === 1 ? "problem" : "problems"}`}>
                  <BlockStack gap="100">
                    {plan.problems.slice(0, 8).map((problem) => <Text as="p" key={problem}>{problem}</Text>)}
                    {plan.problems.length > 8 && <Text as="p">{`…and ${plan.problems.length - 8} more.`}</Text>}
                  </BlockStack>
                </Banner>
              )}

              {singleObject && duplicateNames.length > 0 && (
                <Banner tone="info" title="Some field names repeat">
                  <p>{`${duplicateNames.slice(0, 6).join(", ")}${duplicateNames.length > 6 ? "…" : ""} appear on more than one field. That's allowed, but renaming them below makes the object easier to fill in.`}</p>
                </Banner>
              )}

              {!single && plan.objects.length > 0 && (
                <>
                  <Text as="h3" variant="headingSm">Metaobject definitions</Text>
                  <IndexTable resourceName={{ singular: "definition", plural: "definitions" }} itemCount={plan.objects.length} selectable={false} headings={[{ title: "Key" }, { title: "Name" }, { title: "Fields" }, { title: "Status" }]}>
                    {plan.objects.map((object, index) => (
                      <IndexTable.Row id={object.type} key={object.type} position={index}>
                        <IndexTable.Cell><Text as="span" fontWeight="semibold">{object.type}</Text></IndexTable.Cell>
                        <IndexTable.Cell>
                          <TextField label="Name" labelHidden autoComplete="off" value={object.name} onChange={(value) => setObjectNames((prev) => ({ ...prev, [object.type]: value }))} disabled={running} />
                        </IndexTable.Cell>
                        <IndexTable.Cell><Text as="span" tone="subdued" truncate>{`${object.fields.length}: ${object.fields.map((field) => field.key).join(", ")}`}</Text></IndexTable.Cell>
                        <IndexTable.Cell><StepBadge step={stepOf(`object:${object.type}`)} /></IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                </>
              )}

              {singleObject && (
                <>
                  <Box padding="400" background="bg-surface-secondary" borderRadius="300">
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center" gap="400" wrap>
                        <BlockStack gap="100">
                          <Text as="h3" variant="headingMd">{singleObject.name}</Text>
                          <InlineStack gap="200" blockAlign="center">
                            <Text as="span" tone="subdued">{singleObject.type}</Text>
                            <Badge tone={STEP_BADGE[stepOf(`object:${singleObject.type}`).state].tone}>{STEP_BADGE[stepOf(`object:${singleObject.type}`).state].label}</Badge>
                          </InlineStack>
                        </BlockStack>
                        <InlineStack gap="200" blockAlign="center" wrap>
                          <Button onClick={() => void checkInShopify()} loading={checking} disabled={running || checking}>Check in Shopify</Button>
                          <Button onClick={downloadFields}>Download field list (CSV)</Button>
                          {createButton}
                          {running && <Button tone="critical" onClick={() => { stopRef.current = true; }}>Stop</Button>}
                        </InlineStack>
                      </InlineStack>
                      {stepOf(`object:${singleObject.type}`).state === "failed" && <Banner tone="critical"><p>{stepOf(`object:${singleObject.type}`).message}</p></Banner>}
                      {stepOf(`object:${singleObject.type}`).state === "existed" && <Banner tone="warning"><p>{stepOf(`object:${singleObject.type}`).message}</p></Banner>}
                      {!canRun && !running && <Text as="p" tone="subdued">{blockedReason}</Text>}
                    </BlockStack>
                  </Box>
                  {imageMismatches.length > 0 && (
                    <Banner tone="critical" title={`${imageMismatches.length} image ${imageMismatches.length === 1 ? "field is" : "fields are"} not set to the image picker in Shopify`}>
                      <BlockStack gap="200">
                        <p>These accept any file instead of images only. This can happen when the definition already existed.</p>
                        <InlineStack><Button onClick={() => void makeImageOnly()} loading={fixingPickers} disabled={fixingPickers}>Make them image-only</Button></InlineStack>
                      </BlockStack>
                    </Banner>
                  )}
                  {remoteMessage && <Banner tone="info" onDismiss={() => setRemoteMessage(null)}><p>{remoteMessage}</p></Banner>}
                  <IndexTable resourceName={{ singular: "field", plural: "fields" }} itemCount={singleObject.fields.length} selectable={false} headings={[{ title: "#" }, { title: "Name (editable)" }, { title: "Key" }, { title: "Type" }, { title: "In Shopify" }]}>
                    {singleObject.fields.map((field, index) => (
                      <IndexTable.Row id={field.key} key={field.key} position={index}>
                        <IndexTable.Cell>{index + 1}</IndexTable.Cell>
                        <IndexTable.Cell>
                          <TextField label="Field name" labelHidden autoComplete="off" value={field.name} onChange={(value) => setFieldNames((prev) => ({ ...prev, [`${singleObject.type}.${field.key}`]: value }))} disabled={running} />
                        </IndexTable.Cell>
                        <IndexTable.Cell><Text as="span" fontWeight="semibold">{field.key}</Text></IndexTable.Cell>
                        <IndexTable.Cell>{`${typeLabel(field.type)} · ${shopifyTypeText(field.type)}`}</IndexTable.Cell>
                        <IndexTable.Cell>
                          {(() => {
                            const found = remote[singleObject.type]?.find((r) => r.key === field.key);
                            if (!remote[singleObject.type]) return <Text as="span" tone="subdued">—</Text>;
                            if (!found) return <Badge tone="critical">Missing</Badge>;
                            return <Badge tone={matchesRemote(field.type, found) ? "success" : "critical"}>{`${matchesRemote(field.type, found) ? "✓" : "✗"} ${describeRemote(found)}`}</Badge>;
                          })()}
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                </>
              )}

              {metafieldCount > 0 && (
                <>
                  <Text as="h3" variant="headingSm">{`${OWNER_LABEL[ownerType]} metafields (type: metaobject reference)`}</Text>
                  <IndexTable resourceName={{ singular: "metafield", plural: "metafields" }} itemCount={metafieldCount} selectable={false} headings={[{ title: "Metafield" }, { title: "Name" }, { title: "Points at" }, { title: "Status" }]}>
                    {plan.metafields.map((metafield, index) => {
                      const id = `${metafield.namespace}.${metafield.key}`;
                      return (
                        <IndexTable.Row id={id} key={id} position={index}>
                          <IndexTable.Cell><Text as="span" fontWeight="semibold">{id}</Text></IndexTable.Cell>
                          <IndexTable.Cell><Text as="span" truncate>{metafield.name}</Text></IndexTable.Cell>
                          <IndexTable.Cell>{metafield.objectType}</IndexTable.Cell>
                          <IndexTable.Cell><StepBadge step={stepOf(`meta:${id}`)} /></IndexTable.Cell>
                        </IndexTable.Row>
                      );
                    })}
                  </IndexTable>
                </>
              )}

              {!single && (
                <InlineStack gap="300" blockAlign="center">
                  {createButton}
                  {running && <Button tone="critical" onClick={() => { stopRef.current = true; }}>Stop</Button>}
                  {!canRun && !running && <Text as="span" tone="subdued">{blockedReason}</Text>}
                </InlineStack>
              )}

              {finished && (
                <Banner tone={tally.failed === 0 ? "success" : "warning"} title={tally.failed === 0 ? "Done — no entries were created" : "Finished with problems"}>
                  <p>{`${tally.created} created · ${tally.existed} already existed · ${tally.failed} failed · ${tally.skipped} skipped. Only the definitions were made, no metaobject entries. Running it again is safe: anything that already exists is reused.`}</p>
                </Banner>
              )}
            </BlockStack>
          </Card>
        )}

        <BuilderHistory refreshKey={historyKey} disabled={running} onUseFile={attachSavedFile} onRunAgain={(entry) => void runAgain(entry)} />
      </BlockStack>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Create these in your store?"
        primaryAction={{ content: "Create", onAction: () => void run() }}
        secondaryActions={[{ content: "Cancel", onAction: () => setConfirmOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p">{`${plan.objects.length} metaobject ${plan.objects.length === 1 ? "definition" : "definitions"}${metafieldCount > 0 ? ` and ${metafieldCount} ${OWNER_LABEL[ownerType].toLowerCase()} ${metafieldCount === 1 ? "metafield" : "metafields"}` : ""} will be created${storefront ? ", with storefront access" : ""}. No entries are created. A definition that already exists is reused, never overwritten.`}</Text>
            <Text as="p" tone="subdued">This needs write access for metaobject definitions on your key, plus products (or collections) write access for the metafield.</Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
