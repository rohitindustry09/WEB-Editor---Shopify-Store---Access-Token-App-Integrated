"use client";

import { useState, type ReactNode } from "react";
import { Badge, BlockStack, Box, Button, Collapsible, Divider, InlineGrid, InlineStack, Text } from "@shopify/polaris";
import { ChevronDownIcon, ChevronUpIcon } from "@shopify/polaris-icons";
import { SearchableSelect, type PickerOption } from "./SearchableSelect";

const SAMPLE_LIMIT = 70;

/**
 * One field → CSV column choice laid out as a row: what the field is (and any
 * caveat) on the left, the column picker in the middle, and a live sample of
 * what the chosen column holds in the first CSV row on the right — so the
 * mapping can be checked by eye without scrolling to the file preview.
 */
export function MappingRow({
  id,
  label,
  caption,
  options,
  value,
  onChange,
  sample,
  isAuto,
  disabled,
  extra,
}: {
  /** Stable id for the visible label. */
  id: string;
  label: string;
  caption?: string;
  options: PickerOption[];
  value: string;
  onChange: (value: string) => void;
  /** The chosen column's value in the first CSV row (undefined when nothing is chosen). */
  sample: string | undefined;
  isAuto: boolean;
  disabled: boolean;
  /** Extra controls shown full-width under the row (e.g. a rich text editor). */
  extra?: ReactNode;
}) {
  const mapped = value !== "";
  const shownSample = sample === undefined ? "" : sample.length > SAMPLE_LIMIT ? `${sample.slice(0, SAMPLE_LIMIT)}…` : sample;

  return (
    <Box paddingBlock="300" borderBlockEndWidth="025" borderColor="border">
      <InlineGrid columns={{ xs: 1, md: ["oneThird", "oneThird", "oneThird"] }} gap={{ xs: "150", md: "400" }} alignItems="center">
        <BlockStack gap="050">
          <InlineStack gap="150" blockAlign="center" wrap>
            <Text as="span" variant="bodyMd" fontWeight="semibold" id={`${id}-label`}>{label}</Text>
            {mapped && <Badge tone={isAuto ? "info" : "success"} size="small">{isAuto ? "Auto-matched" : "Mapped"}</Badge>}
          </InlineStack>
          {caption && <Text as="span" variant="bodySm" tone="subdued">{caption}</Text>}
        </BlockStack>

        <SearchableSelect label={`Column for ${label}`} labelHidden options={options} value={value} onChange={onChange} noneLabel="Don't change" disabled={disabled} />

        <Box minWidth="0">
          {mapped ? (
            <BlockStack gap="050">
              <Text as="span" variant="bodySm" tone="subdued">First row</Text>
              <Text as="span" variant="bodyMd" breakWord>{shownSample || "(empty — nothing is written for this row)"}</Text>
            </BlockStack>
          ) : (
            <Text as="span" variant="bodySm" tone="subdued">Left unchanged</Text>
          )}
        </Box>
      </InlineGrid>
      {extra && <Box paddingBlockStart="300">{extra}</Box>}
    </Box>
  );
}

/** A titled, collapsible group of mapping rows with a "n of m mapped" summary — keeps a long field list scannable. */
export function MappingSection({
  id,
  title,
  description,
  mappedCount,
  totalCount,
  defaultOpen = true,
  children,
}: {
  id: string;
  title: string;
  description: string;
  mappedCount: number;
  totalCount: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = `${id}-content`;

  return (
    <Box background="bg-surface" borderWidth="025" borderColor="border" borderRadius="300">
      <Box padding="300">
        <InlineStack align="space-between" blockAlign="center" gap="300" wrap={false}>
          <BlockStack gap="050">
            <InlineStack gap="200" blockAlign="center">
              <Text as="h4" variant="headingSm">{title}</Text>
              <Badge tone={mappedCount > 0 ? "success" : undefined}>{`${mappedCount} of ${totalCount} mapped`}</Badge>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">{description}</Text>
          </BlockStack>
          <Button
            variant="tertiary"
            icon={open ? ChevronUpIcon : ChevronDownIcon}
            onClick={() => setOpen((v) => !v)}
            ariaExpanded={open}
            ariaControls={contentId}
            accessibilityLabel={`${open ? "Hide" : "Show"} ${title}`}
          />
        </InlineStack>
      </Box>
      <Collapsible open={open} id={contentId} transition={{ duration: "150ms", timingFunction: "ease-in-out" }}>
        <Divider />
        <Box paddingInline="300" paddingBlock="100">
          <BlockStack gap="0">{children}</BlockStack>
        </Box>
      </Collapsible>
    </Box>
  );
}
