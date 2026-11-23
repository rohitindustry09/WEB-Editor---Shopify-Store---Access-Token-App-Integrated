"use client";

import { useMemo, useState, type ReactNode } from "react";
import { BlockStack, Banner, Button, ButtonGroup, SkeletonBodyText, Text, TextField } from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";
import type { MetafieldDefinitionSummary } from "@/lib/shopify/metafields";
import { RICH_TEXT_FORMAT_OPTIONS, type RichTextFormat } from "@/lib/richText";
import { MappingRow, MappingSection } from "./MappingRow";
import { RichTextEditor } from "./RichTextEditor";
import type { PickerOption } from "./SearchableSelect";

/** Without a search, only this many metafields render at once — a store can define hundreds, and each picker is a full autocomplete. */
const VISIBLE_WITHOUT_SEARCH = 30;

/** Definition id → CSV column index. A metafield that isn't listed is never touched. */
export type MetafieldColumnMap = Record<string, number>;

const RICH_TEXT_TYPE = "rich_text_field";
/** Picker value meaning "write the content once here and save it on every product" — offered for rich text metafields only. */
const WRITE_ONCE_VALUE = "__write_once__";
const WRITE_ONCE_OPTION: PickerOption = { value: WRITE_ONCE_VALUE, label: "✎ Write one content for all products", helpText: "Same formatted content is saved on every product" };

export function MetafieldMappingSection({
  definitions,
  loading,
  error,
  columnOptions,
  mapping,
  autoMatchedIds,
  sampleRow,
  fixedContent,
  formats,
  onChange,
  onFixedChange,
  onFormatChange,
  disabled,
}: {
  /** null while the store's metafield definitions are still loading. */
  definitions: MetafieldDefinitionSummary[] | null;
  loading: boolean;
  error: string | null;
  columnOptions: PickerOption[];
  mapping: MetafieldColumnMap;
  /** Definitions whose column was picked automatically from a matching CSV header. */
  autoMatchedIds: ReadonlySet<string>;
  /** The first CSV data row, used to show a sample under each mapped metafield. */
  sampleRow: string[];
  /** Rich text metafields set to "write once": definition id → the HTML typed in the editor. */
  fixedContent: Record<string, string>;
  /** Rich text metafields fed from a CSV column: how that text is laid out. */
  formats: Record<string, RichTextFormat>;
  onChange: (definitionId: string, column: number | null) => void;
  onFixedChange: (definitionId: string, html: string | null) => void;
  onFormatChange: (definitionId: string, format: RichTextFormat) => void;
  disabled: boolean;
}) {
  const [filter, setFilter] = useState("");

  const needle = filter.trim().toLowerCase();
  const shown = useMemo(() => {
    const list = definitions ?? [];
    const matching = needle
      ? list.filter((d) => `${d.name} ${d.namespace}.${d.key} ${d.typeName}`.toLowerCase().includes(needle))
      : list;
    // Mapped metafields float to the top so what will be written is always visible.
    const sorted = [...matching].sort((a, b) => Number(mapping[b.id] !== undefined) - Number(mapping[a.id] !== undefined));
    return needle ? sorted : sorted.slice(0, Math.max(VISIBLE_WITHOUT_SEARCH, sorted.filter((d) => mapping[d.id] !== undefined).length));
  }, [definitions, needle, mapping]);

  const total = definitions?.length ?? 0;
  const mappedCount = Object.keys(mapping).length + Object.keys(fixedContent).length;

  return (
    <MappingSection
      id="metafields"
      title="Metafields"
      description={`Custom data on the product. ${total.toLocaleString()} defined in your store.`}
      mappedCount={mappedCount}
      totalCount={total}
    >
      <BlockStack gap="300">
        {loading && <SkeletonBodyText lines={3} />}
        {error && <Banner tone="warning"><p>{error}</p></Banner>}

        {definitions !== null && total === 0 && !error && (
          <Text as="p" variant="bodySm" tone="subdued">This store has no product metafield definitions to map.</Text>
        )}

        {total > 0 && (
          <>
            <TextField
              label="Find a metafield"
              labelHidden
              value={filter}
              onChange={setFilter}
              placeholder="Search metafields by name, namespace.key or type…"
              prefix={<SearchIcon />}
              autoComplete="off"
              clearButton
              onClearButtonClick={() => setFilter("")}
            />
            <div role="list">
              {shown.map((definition) => {
                const column = mapping[definition.id];
                const isRich = definition.typeName === RICH_TEXT_TYPE;
                const writeOnce = isRich && fixedContent[definition.id] !== undefined;
                const format = formats[definition.id] ?? "paragraphs";
                const pickerValue = writeOnce ? WRITE_ONCE_VALUE : column !== undefined ? String(column) : "";
                const handlePick = (v: string) => {
                  if (v === WRITE_ONCE_VALUE) {
                    onChange(definition.id, null);
                    onFixedChange(definition.id, "");
                  } else {
                    onFixedChange(definition.id, null);
                    onChange(definition.id, v === "" ? null : Number(v));
                  }
                };
                let extra: ReactNode = null;
                if (writeOnce) {
                  extra = (
                    <BlockStack gap="150">
                      <Text as="span" variant="bodySm" tone="subdued">This content is saved on every product in this run, with the formatting you apply here.</Text>
                      <RichTextEditor id={`rte-${definition.id}`} label={`${definition.name} content`} initialHtml={fixedContent[definition.id]} onChange={(html) => onFixedChange(definition.id, html)} disabled={disabled} />
                    </BlockStack>
                  );
                } else if (isRich && column !== undefined) {
                  extra = (
                    <BlockStack gap="150">
                      <Text as="span" variant="bodySm" fontWeight="semibold">Save the CSV text as</Text>
                      <ButtonGroup variant="segmented">
                        {RICH_TEXT_FORMAT_OPTIONS.map((option) => (
                          <Button key={option.value} pressed={format === option.value} disabled={disabled} onClick={() => onFormatChange(definition.id, option.value)}>
                            {option.label}
                          </Button>
                        ))}
                      </ButtonGroup>
                      <Text as="span" variant="bodySm" tone="subdued">A line break or a | in the cell starts the next paragraph or list item, e.g. &ldquo;Height 5 cm | Width 3 cm | Weight 50 g&rdquo;. A cell that starts with &ldquo;* &rdquo; becomes a bulleted list. HTML lists in the cell are kept as they are.</Text>
                    </BlockStack>
                  );
                }
                return (
                  <div role="listitem" key={definition.id}>
                    <MappingRow
                      id={`mf-${definition.id}`}
                      label={definition.name}
                      caption={`${definition.namespace}.${definition.key} · ${definition.typeName}`}
                      options={isRich ? [WRITE_ONCE_OPTION, ...columnOptions] : columnOptions}
                      value={pickerValue}
                      onChange={handlePick}
                      sample={writeOnce ? "Same content for every product" : column !== undefined ? (sampleRow[column] ?? "") : undefined}
                      isAuto={!writeOnce && autoMatchedIds.has(definition.id)}
                      disabled={disabled}
                      extra={extra}
                    />
                  </div>
                );
              })}
            </div>
            {shown.length === 0 && <Text as="p" variant="bodySm" tone="subdued">No metafields match your search.</Text>}
            {!needle && total > shown.length && (
              <Text as="p" variant="bodySm" tone="subdued">{`Showing ${shown.length.toLocaleString()} of ${total.toLocaleString()} — search to find the others.`}</Text>
            )}
            <Text as="p" variant="bodySm" tone="subdued">
              Cells are converted to each metafield&apos;s type automatically: rich text becomes a formatted document (a line break or || starts a new paragraph), yes/no becomes true/false, \u201C12 CM\u201D becomes a dimension, and comma-separated text becomes a list. Other types must already be in the right format.
            </Text>
          </>
        )}
      </BlockStack>
    </MappingSection>
  );
}
