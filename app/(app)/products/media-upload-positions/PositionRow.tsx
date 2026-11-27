"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Badge, BlockStack, Box, InlineStack, Select, Text, Thumbnail } from "@shopify/polaris";
import { describeIssue, STEP_LABELS, type PositionStep } from "@/lib/positionMedia";
import { readFolderImages, type StreamingZipHandle } from "@/lib/skuMediaZip";
import type { PositionRowModel, RowResult } from "./rowModel";

const STATE_TONE = { replace: "info", missing: "warning", "not-image": "warning", "not-ready": "warning" } as const;

/** The picture from the zip, read on demand and shown as a thumbnail; formats a browser can't display simply show nothing. */
function ZipImageThumb({ zip, path }: { zip: StreamingZipHandle; path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    readFolderImages(zip, [path])
      .then(([file]) => {
        if (!file || cancelled) return;
        objectUrl = URL.createObjectURL(file.blob);
        setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [zip, path]);
  return url ? <Thumbnail source={url} alt="" size="small" /> : <Box minWidth="40px" />;
}

function Captioned({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <BlockStack gap="050" inlineAlign="center">
      {children}
      <Text as="span" variant="bodyXs" tone="subdued">{caption}</Text>
    </BlockStack>
  );
}

function StepLine({ step, zip, outcome }: { step: PositionStep; zip: StreamingZipHandle | null; outcome?: { ok: boolean; error?: string } }) {
  return (
    <InlineStack gap="300" blockAlign="center" wrap={false}>
      <Captioned caption="Current">
        {step.target?.url ? <Thumbnail source={step.target.url} alt="" size="small" /> : <Box minWidth="40px" />}
      </Captioned>
      <BlockStack gap="050">
        <Text as="span" variant="bodyMd">
          Position {step.position} ← <b>{step.filename}</b>
        </Text>
        {outcome?.error && <Text as="span" variant="bodySm" tone="critical">{outcome.error}</Text>}
      </BlockStack>
      {zip && (
        <Captioned caption="New">
          <ZipImageThumb zip={zip} path={step.path} />
        </Captioned>
      )}
      {outcome ? (
        <Badge tone={outcome.ok ? "success" : "critical"}>{outcome.ok ? "Replaced" : "Failed"}</Badge>
      ) : (
        <Badge tone={STATE_TONE[step.state]}>{STEP_LABELS[step.state]}</Badge>
      )}
    </InlineStack>
  );
}

/** One SKU folder: which product it landed on, and what each numbered file will do to that product's gallery. */
export function PositionRow({
  row,
  zip,
  result,
  disabled,
  onChoose,
}: {
  row: PositionRowModel;
  zip: StreamingZipHandle | null;
  result?: RowResult;
  disabled: boolean;
  onChoose: (productId: string) => void;
}) {
  const outcomeByPosition = new Map((result?.outcomes ?? []).map((o) => [o.position, o]));
  const ambiguous = row.candidates.length > 1;

  return (
    <Box padding="400" borderBlockEndWidth="025" borderColor="border">
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center" gap="300">
          <BlockStack gap="050">
            <Text as="h3" variant="headingSm">{row.sku}</Text>
            {row.product && <Text as="span" tone="subdued" variant="bodySm">{row.product.title}</Text>}
          </BlockStack>
          {row.candidates.length === 0 && <Badge tone="critical">No product has this SKU</Badge>}
          {row.product && <Badge tone={row.product.status === "ACTIVE" ? "success" : "attention"}>{row.product.status.toLowerCase()}</Badge>}
        </InlineStack>

        {ambiguous && (
          <Select
            label="Several products share this SKU — pick the one to update"
            options={[{ label: "Choose a product…", value: "" }, ...row.candidates.map((c) => ({ label: `${c.title} (${c.status.toLowerCase()})`, value: c.id }))]}
            value={row.product?.id ?? ""}
            onChange={onChoose}
            disabled={disabled}
          />
        )}

        {row.product && row.gallery === null && <Text as="span" tone="subdued">Reading the product&apos;s images…</Text>}
        {row.gallery?.ok === false && <Text as="span" tone="critical">{row.gallery.error}</Text>}
        {result?.error && <Text as="span" tone="critical">{result.error}</Text>}

        {row.steps.length > 0 && (
          <BlockStack gap="200">
            {row.steps.map((step) => (
              <StepLine key={step.position} step={step} zip={zip} outcome={outcomeByPosition.get(step.position)} />
            ))}
          </BlockStack>
        )}

        {row.gallery?.ok && (
          <Text as="span" tone="subdued" variant="bodySm">
            The product has {row.gallery.media.length} image{row.gallery.media.length === 1 ? "" : "s"} / media item{row.gallery.media.length === 1 ? "" : "s"} now.
          </Text>
        )}
        {row.parse.issues.map((issue, index) => (
          <Text key={index} as="span" tone="caution" variant="bodySm">{describeIssue(issue)}</Text>
        ))}
        {row.parse.files.length === 0 && row.parse.issues.length === 0 && <Text as="span" tone="caution" variant="bodySm">This folder has no images.</Text>}
      </BlockStack>
    </Box>
  );
}
