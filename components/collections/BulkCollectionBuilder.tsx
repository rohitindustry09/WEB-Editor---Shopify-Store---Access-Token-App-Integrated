"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Button,
  Badge,
  Thumbnail,
  Checkbox,
  Banner,
  Box,
} from "@shopify/polaris";
import {
  createCollectionFromListAction,
  resolveIdentifiersAction,
  type ResolvedMatch,
} from "@/app/(app)/products/collections/build/actions";

type Step = 1 | 2 | 3 | 4 | 5;

const STEP_LABELS = ["Name", "Paste list", "Review", "Create", "Done"];

function parseIdentifiers(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

export function BulkCollectionBuilder() {
  const [step, setStep] = useState<Step>(1);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [raw, setRaw] = useState("");
  const [matches, setMatches] = useState<ResolvedMatch[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdHandle, setCreatedHandle] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const identifiers = useMemo(() => parseIdentifiers(raw), [raw]);
  const matched = matches.filter((m) => m.product);
  const notFound = matches.filter((m) => !m.product);
  const includedProducts = matched
    .filter((m) => !excluded.has(m.product!.id))
    .map((m) => m.product!);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setRaw((prev) => (prev ? `${prev}\n${text}` : text));
    };
    reader.readAsText(file);
  };

  const runResolve = () => {
    setResolveError(null);
    startTransition(async () => {
      const result = await resolveIdentifiersAction(identifiers);
      if (!result.ok) {
        setResolveError(result.error ?? "Couldn't look up those products.");
        return;
      }
      setMatches(result.matches);
      setExcluded(new Set());
      setStep(3);
    });
  };

  const runCreate = () => {
    setCreateError(null);
    startTransition(async () => {
      const result = await createCollectionFromListAction({
        title,
        description,
        productIds: includedProducts.map((p) => p.id),
      });
      if (!result.ok) {
        setCreateError(result.error ?? "Couldn't create the collection.");
        return;
      }
      setCreatedHandle(result.handle ?? null);
      setStep(5);
    });
  };

  if (step === 5) {
    return (
      <Card>
        <BlockStack gap="400" align="center">
          <Text as="h2" variant="headingLg" alignment="center">
            &ldquo;{title}&rdquo; is live
          </Text>
          <Text as="p" tone="subdued" alignment="center">
            {includedProducts.length} products were added to your new collection in Shopify.
          </Text>
          {createdHandle && (
            <Text as="p" tone="subdued" alignment="center" variant="bodySm">
              Handle: {createdHandle}
            </Text>
          )}
          <InlineStack align="center" gap="300">
            <Button url="/products/collections" variant="primary">View collections</Button>
            <Button
              onClick={() => {
                setStep(1);
                setTitle("");
                setDescription("");
                setRaw("");
                setMatches([]);
                setExcluded(new Set());
                setCreatedHandle(null);
              }}
            >
              Build another
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>
    );
  }

  return (
    <BlockStack gap="400">
      <InlineStack gap="200">
        {STEP_LABELS.slice(0, 4).map((label, i) => {
          const n = (i + 1) as Step;
          return (
            <Badge key={label} tone={n === step ? "info" : n < step ? "success" : undefined}>
              {`${i + 1}. ${label}`}
            </Badge>
          );
        })}
      </InlineStack>

      {step === 1 && (
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Name the collection</Text>
            <TextField
              label="Title"
              autoComplete="off"
              value={title}
              onChange={setTitle}
              placeholder="e.g. Diwali Gifting Edit"
              autoFocus
            />
            <TextField
              label="Description (optional)"
              autoComplete="off"
              multiline={3}
              value={description}
              onChange={setDescription}
            />
            <InlineStack align="end">
              <Button variant="primary" disabled={!title.trim()} onClick={() => setStep(2)}>
                Continue
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Paste SKUs or product IDs</Text>
            <Text as="p" tone="subdued">
              One per line, or separated by commas. We&apos;ll match them against your live catalog.
            </Text>
            <TextField
              label="Identifiers"
              labelHidden
              autoComplete="off"
              multiline={10}
              value={raw}
              onChange={setRaw}
              placeholder={"BT-DIYA-002\nBT-IDL-031\n7891234567890\n…"}
            />
            {resolveError && (
              <Banner tone="critical"><p>{resolveError}</p></Banner>
            )}
            <InlineStack align="space-between" blockAlign="center">
              <Text as="span" tone="subdued">{identifiers.length} identifiers parsed</Text>
              <Button variant="plain" onClick={() => fileInputRef.current?.click()}>
                or upload a CSV
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                  e.target.value = "";
                }}
              />
            </InlineStack>
            <InlineStack align="space-between">
              <Button onClick={() => setStep(1)}>Back</Button>
              <Button
                variant="primary"
                disabled={identifiers.length === 0}
                loading={pending}
                onClick={runResolve}
              >
                Review matches
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      )}

      {step === 3 && (
        <BlockStack gap="400">
          <InlineStack gap="200">
            <Badge tone="success">{`${matched.length} matched`}</Badge>
            {notFound.length > 0 && <Badge tone="critical">{`${notFound.length} not found`}</Badge>}
          </InlineStack>

          <Card padding="0">
            <Box padding="300" borderBlockEndWidth="025" borderColor="border">
              <Text as="h3" variant="headingSm">Matched products</Text>
            </Box>
            <BlockStack gap="0">
              {matched.length === 0 && (
                <Box padding="400"><Text as="p" tone="subdued">No matches.</Text></Box>
              )}
              {matched.map(({ product, raw: rawId }) => {
                const p = product!;
                return (
                  <Box key={p.id} padding="300" borderBlockEndWidth="025" borderColor="border">
                    <InlineStack gap="300" blockAlign="center">
                      <Checkbox
                        label=""
                        labelHidden
                        checked={!excluded.has(p.id)}
                        onChange={() =>
                          setExcluded((prev) => {
                            const next = new Set(prev);
                            if (next.has(p.id)) next.delete(p.id);
                            else next.add(p.id);
                            return next;
                          })
                        }
                      />
                      <Thumbnail source={p.images.nodes[0]?.url ?? ""} alt={p.title} size="small" />
                      <BlockStack gap="0">
                        <Text as="span">{p.title}</Text>
                        <Text as="span" tone="subdued" variant="bodySm">matched from &ldquo;{rawId}&rdquo;</Text>
                      </BlockStack>
                    </InlineStack>
                  </Box>
                );
              })}
            </BlockStack>
          </Card>

          {notFound.length > 0 && (
            <Card padding="0">
              <Box padding="300" borderBlockEndWidth="025" borderColor="border">
                <Text as="h3" variant="headingSm" tone="critical">Not found</Text>
              </Box>
              <BlockStack gap="0">
                {notFound.map(({ raw: rawId }) => (
                  <Box key={rawId} padding="300" borderBlockEndWidth="025" borderColor="border">
                    <InlineStack align="space-between">
                      <Text as="span">{rawId}</Text>
                      <Button variant="plain" url={`/products?query=${encodeURIComponent(rawId)}`}>
                        Search manually
                      </Button>
                    </InlineStack>
                  </Box>
                ))}
              </BlockStack>
            </Card>
          )}

          <InlineStack align="space-between">
            <Button onClick={() => setStep(2)}>Back</Button>
            <Button variant="primary" disabled={includedProducts.length === 0} onClick={() => setStep(4)}>
              Continue
            </Button>
          </InlineStack>
        </BlockStack>
      )}

      {step === 4 && (
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Ready to create</Text>
            {createError && <Banner tone="critical"><p>{createError}</p></Banner>}
            <Box background="bg-surface-secondary" padding="300" borderRadius="200">
              <BlockStack gap="150">
                <Text as="p" fontWeight="semibold">{title}</Text>
                {description && <Text as="p" tone="subdued">{description}</Text>}
                <Text as="p" tone="subdued">{includedProducts.length} products included</Text>
              </BlockStack>
            </Box>
            <InlineStack align="space-between">
              <Button onClick={() => setStep(3)}>Back</Button>
              <Button variant="primary" loading={pending} onClick={runCreate}>
                {`Create collection with ${includedProducts.length} products`}
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      )}
    </BlockStack>
  );
}
