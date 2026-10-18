"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Button,
  RadioButton,
  Banner,
  Thumbnail,
  ActionList,
  Popover,
  Box,
} from "@shopify/polaris";
import { HtmlEditor } from "@/components/ui/HtmlEditor";
import { RuleBuilder } from "@/components/collections/RuleBuilder";
import { createCollectionAction } from "./actions";
import type { Rule } from "@/lib/collectionRules";

interface SearchResult {
  id: string;
  title: string;
  images: { nodes: { url: string; altText: string | null }[] };
}

export function NewCollectionForm() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [type, setType] = useState<"manual" | "automated">("manual");
  const [appliedDisjunctively, setAppliedDisjunctively] = useState(false);
  const [rules, setRules] = useState<Rule[]>([{ column: "TITLE", relation: "EQUALS", condition: "" }]);
  const [products, setProducts] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [popoverActive, setPopoverActive] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) return;
    debounceRef.current = setTimeout(async () => {
      const res = await fetch(`/api/products/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.ok) setResults(data.products);
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);
  const visibleResults = query.trim() ? results : [];

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await createCollectionAction({
        title,
        description,
        imageUrl,
        type,
        productIds: products.map((p) => p.id),
        appliedDisjunctively,
        rules,
      });
      if (!result.ok) setError(result.error ?? "Couldn't create collection.");
    });
  };

  return (
    <Page fullWidth title="Create collection" backAction={{ content: "Collections", url: "/products/collections" }}>
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical" title="Couldn't create collection">
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="400">
                <TextField label="Title" autoComplete="off" value={title} onChange={setTitle} autoFocus />
                <HtmlEditor label="Description" value={description} onChange={setDescription} />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingSm">Collection type</Text>
                <RadioButton label="Manual — I'll add products myself" checked={type === "manual"} onChange={() => setType("manual")} />
                <RadioButton label="Automated — Shopify adds matching products" checked={type === "automated"} onChange={() => setType("automated")} />
              </BlockStack>
            </Card>

            {type === "manual" ? (
              <Card padding="0">
                <Box padding="300" borderBlockEndWidth="025" borderColor="border">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" tone="subdued">{products.length} products</Text>
                    <Popover
                      active={popoverActive}
                      onClose={() => setPopoverActive(false)}
                      activator={
                        <Button onClick={() => setPopoverActive((a) => !a)}>Add products</Button>
                      }
                    >
                      <Box padding="200" minWidth="280px">
                        <TextField
                          label="Search products"
                          labelHidden
                          autoComplete="off"
                          placeholder="Search products…"
                          value={query}
                          onChange={setQuery}
                          autoFocus
                        />
                      </Box>
                      {visibleResults.length > 0 && (
                        <ActionList
                          items={visibleResults
                            .filter((r) => !products.some((p) => p.id === r.id))
                            .map((r) => ({
                              content: r.title,
                              prefix: <Thumbnail source={r.images.nodes[0]?.url ?? ""} alt="" size="small" />,
                              onAction: () => {
                                setProducts((prev) => [...prev, r]);
                                setPopoverActive(false);
                                setQuery("");
                              },
                            }))}
                        />
                      )}
                    </Popover>
                  </InlineStack>
                </Box>
                <BlockStack gap="0">
                  {products.map((p) => (
                    <Box key={p.id} padding="300" borderBlockEndWidth="025" borderColor="border">
                      <InlineStack align="space-between" blockAlign="center">
                        <InlineStack gap="300" blockAlign="center">
                          <Thumbnail source={p.images.nodes[0]?.url ?? ""} alt={p.title} size="small" />
                          <Text as="span">{p.title}</Text>
                        </InlineStack>
                        <Button variant="plain" tone="critical" onClick={() => setProducts((prev) => prev.filter((x) => x.id !== p.id))}>
                          Remove
                        </Button>
                      </InlineStack>
                    </Box>
                  ))}
                </BlockStack>
              </Card>
            ) : (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingSm">Conditions</Text>
                  <RuleBuilder
                    appliedDisjunctively={appliedDisjunctively}
                    onAppliedDisjunctivelyChange={setAppliedDisjunctively}
                    rules={rules}
                    onRulesChange={setRules}
                  />
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingSm">Image</Text>
              <TextField
                label="Image URL"
                autoComplete="off"
                value={imageUrl}
                onChange={setImageUrl}
                placeholder="https://…"
                helpText="Paste a hosted image URL — direct file upload isn't wired up yet."
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <InlineStack align="end">
            <Button variant="primary" loading={pending} disabled={!title.trim()} onClick={submit}>
              Save collection
            </Button>
          </InlineStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
